import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high_level/tenant-context";
import {
  associateLeadWithTenant,
  createLead,
  findLeadByChannelValues,
} from "@/server/db/queries/leads";
import { genericCount } from "@/server/db/queries/generics";
import { rid } from "@/server/db/connection";
import { getSystemIdBySlug } from "@/server/db/queries/systems";
import { dispatchCommunication } from "@/server/event-queue/handlers/send-communication";
import Core from "@/server/utils/Core";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { communicationGuard } from "@/server/utils/verification-guard";
import { findVerifiedOwnerByTypedChannel } from "@/server/db/queries/entity-channels";

interface SubmittedChannel {
  type: string;
  value: string;
}

async function parseChannels(raw: unknown): Promise<SubmittedChannel[]> {
  if (!Array.isArray(raw)) return [];
  const out: SubmittedChannel[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const t = (entry as { type?: unknown }).type;
    const v = (entry as { value?: unknown }).value;
    if (typeof t !== "string" || typeof v !== "string") continue;
    const std = await standardizeField(t, v, "entity_channel");
    if (std.length === 0) continue;
    out.push({ type: t, value: std });
  }
  return out;
}

async function postHandler(req: Request, ctx: RequestContext) {
  let body: Record<string, unknown> | null = null;
  try {
    const parsedBody = await req.json() as Record<string, unknown>;
    body = parsedBody;
    const tenantIds: string[] = Array.isArray(parsedBody.tenantIds)
      ? [
        ...new Set(
          parsedBody.tenantIds.filter((
            tenantId: unknown,
          ): tenantId is string =>
            typeof tenantId === "string" && tenantId.trim().length > 0
          ),
        ),
      ]
      : [];
    const botToken = parsedBody.botToken as string | undefined;
    const profile = parsedBody.profile as
      | { name?: string; avatarUri?: string; dateOfBirth?: string }
      | undefined;
    const systemSlug = parsedBody.systemSlug as string | undefined;
    const termsAccepted = Boolean(parsedBody.termsAccepted);
    const locale = parsedBody.locale as string | undefined;
    const faceDescriptor = parsedBody.faceDescriptor as number[] | undefined;
    const avatarUri = parsedBody.avatarUri as string | undefined;
    const tags = Array.isArray(parsedBody.tags) ? parsedBody.tags : undefined;
    const channels = await parseChannels(parsedBody.channels);
    const name = parsedBody.name
      ? await standardizeField("name", String(parsedBody.name), "lead")
      : undefined;

    if (!botToken) {
      return Response.json(
        {
          success: false,
          error: { code: "BOT_CHECK", message: "common.error.botCheck" },
        },
        { status: 403 },
      );
    }

    if (!termsAccepted) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: ["validation.terms.required"],
          },
        },
        { status: 400 },
      );
    }

    const errors: string[] = [
      ...await validateField("name", name, "lead"),
    ];
    for (const ch of channels) {
      errors.push(...await validateField(ch.type, ch.value, "entity_channel"));
    }
    if (channels.length === 0) errors.push("validation.channel.required");
    if (!profile?.name || !systemSlug) {
      errors.push("validation.name.required");
    }

    if (errors.length > 0) {
      return Response.json(
        {
          success: false,
          error: { code: "VALIDATION", errors },
        },
        { status: 400 },
      );
    }

    if (!tenantIds || tenantIds.length === 0) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: ["validation.company.required"],
          },
        },
        { status: 400 },
      );
    }

    const mergedProfile = profile
      ? {
        ...profile,
        avatarUri: avatarUri ?? profile.avatarUri,
      }
      : avatarUri
      ? { avatarUri }
      : undefined;

    const systemId = await getSystemIdBySlug(systemSlug!);

    if (!systemId) {
      return Response.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "common.error.systemNotFound" },
        },
        { status: 404 },
      );
    }

    // Cross-entity conflict: reject if any submitted channel value is already
    // verified by another user or lead.
    for (const ch of channels) {
      const verifiedOwner = await findVerifiedOwnerByTypedChannel(
        ch.type,
        ch.value,
      );
      if (verifiedOwner) {
        return Response.json(
          {
            success: false,
            error: {
              code: "CONFLICT",
              errors: ["validation.channel.conflict"],
            },
          },
          { status: 409 },
        );
      }
    }

    // Look up any existing lead matching ANY of the submitted channel values.
    const existing = await findLeadByChannelValues(
      channels.map((c) => c.value),
    );

    if (existing) {
      const guardResult = await communicationGuard({
        ownerId: existing.id,
        ownerType: "lead",
        actionKey: "auth.action.leadUpdate",
        payload: {
          name: name ?? undefined,
          channels,
          profile: mergedProfile,
          tags,
          tenantIds,
          systemId,
          systemSlug,
          faceDescriptor: Array.isArray(faceDescriptor)
            ? faceDescriptor
            : undefined,
        },
        tenant: {
          tenantIds: [ctx.tenantContext.tenant.id!],
          systemSlug,
        },
      });

      if (!guardResult.allowed) {
        return Response.json(
          {
            success: false,
            error: {
              code: guardResult.reason === "previousNotExpired"
                ? "COOLDOWN"
                : "RATE_LIMITED",
              message: guardResult.reason === "previousNotExpired"
                ? "validation.verification.previousNotExpired"
                : "validation.verification.rateLimited",
            },
          },
          { status: 429 },
        );
      }

      const core = Core.getInstance();
      const settingScope = systemId ? { systemId } : undefined;
      const expiryMinutes = Number(
        (await core.getSetting(
          "auth.communication.expiry.minutes",
          settingScope,
        )) || 15,
      );
      const baseUrl = (await core.getSetting("app.baseUrl", settingScope)) ??
        "http://localhost:3000";
      const confirmationLink =
        `${baseUrl}/verify?token=${guardResult.token}&systemSlug=${
          encodeURIComponent(systemSlug ?? "")
        }`;

      const channelOrder = [...new Set(channels.map((c) => c.type))];

      await dispatchCommunication({
        channels: channelOrder,
        recipients: [existing.id],
        template: "human-confirmation",
        allowUnverified: true,
        templateData: {
          actionKey: "auth.action.leadUpdate",
          confirmationLink,
          occurredAt: new Date().toISOString(),
          actorName: existing.name,
          expiryMinutes: String(expiryMinutes),
          locale: locale || undefined,
          systemSlug,
        },
      });

      return Response.json({
        success: true,
        data: {
          requiresVerification: true,
          message: "common.verificationSent",
        },
      });
    }

    const lead = await createLead({
      name: name!,
      profile: mergedProfile as {
        name: string;
        avatarUri?: string;
        dateOfBirth?: string;
      },
      channels,
      tenantIds,
      tags,
    });

    for (const tenantRecordId of tenantIds) {
      const alreadyAssociated = (await genericCount({
        table: "lead",
        tenant: { id: tenantRecordId },
        extraConditions: ["id = $leadId"],
        extraBindings: { leadId: rid(lead.id) },
      })) > 0;
      if (!alreadyAssociated) {
        await associateLeadWithTenant({
          leadId: lead.id,
          tenantId: tenantRecordId,
        });
      }
    }

    // Gather the newly-created channel ids for the confirmation payload.
    const channelIds = (lead.channelIds ?? [])
      .map((c: unknown) =>
        typeof c === "string" ? c : String((c as { id?: string }).id ?? "")
      )
      .filter((s) => s.length > 0);

    const guardResult = await communicationGuard({
      ownerId: lead.id,
      ownerType: "lead",
      actionKey: "auth.action.leadRegister",
      payload: { channelIds },
      tenant: {
        tenantIds: [ctx.tenantContext.tenant.id!],
        systemSlug,
      },
    });

    if (guardResult.allowed) {
      const core = Core.getInstance();
      const settingScope = systemId ? { systemId } : undefined;
      const expiryMinutes = Number(
        (await core.getSetting(
          "auth.communication.expiry.minutes",
          settingScope,
        )) || 15,
      );
      const baseUrl = (await core.getSetting("app.baseUrl", settingScope)) ??
        "http://localhost:3000";
      const confirmationLink = `${baseUrl}/verify?token=${guardResult.token}`;

      const channelOrder = [...new Set(channels.map((c) => c.type))];

      await dispatchCommunication({
        channels: channelOrder,
        recipients: [lead.id],
        template: "human-confirmation",
        allowUnverified: true,
        templateData: {
          actionKey: "auth.action.leadRegister",
          confirmationLink,
          occurredAt: new Date().toISOString(),
          actorName: lead.name,
          expiryMinutes: String(expiryMinutes),
          locale: locale || undefined,
          systemSlug,
        },
      });
    }

    return Response.json(
      {
        success: true,
        data: {
          id: lead.id,
          companyId: ctx.tenantContext?.tenant?.companyId,
          systemId: ctx.tenantContext?.tenant?.systemId,
          requiresVerification: true,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("Public lead route error:", {
      tenantIds: body?.tenantIds,
      systemSlug: body?.systemSlug,
      error: err,
    });

    if (
      err instanceof Error &&
      err.message.startsWith("INVALID_RECORD_ID:")
    ) {
      const field = err.message.slice("INVALID_RECORD_ID:".length);
      if (field === "companyId") {
        return Response.json(
          {
            success: false,
            error: {
              code: "VALIDATION",
              message: "validation.company.required",
            },
          },
          { status: 400 },
        );
      }
    }

    return Response.json(
      {
        success: false,
        error: {
          code: "INTERNAL",
          message: "common.error.generic",
        },
      },
      { status: 500 },
    );
  }
}

export { postHandler as publicLeadPostHandler };

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 10 },
  }),
  async (req, ctx) => postHandler(req, ctx),
);
