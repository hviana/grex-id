import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { createLead, findLeadByChannelValues } from "@/server/db/queries/leads";
import {
  genericAssociate,
  genericCount,
  genericList,
} from "@/server/db/queries/generics";
import { ensureCompanySystemTenant } from "@/server/db/queries/billing";
import { rid } from "@/server/db/connection";
import {
  linkOrphanFaceToLead,
  searchOrphanFaceByEmbedding,
  tryUpsertFace,
} from "@systems/grex-id/server/db/queries/faces";
import { dispatchCommunication } from "@/server/event-queue/handlers/send-communication";
import { get } from "@/server/utils/cache";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { communicationGuard } from "@/server/utils/verification-guard";
import { findVerifiedOwnerByTypedChannel } from "@/server/db/queries/entity-channels";
import type { SubmittedChannel } from "@/src/contracts/high-level/channels";

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

async function handleFaceBiometrics(
  leadId: string,
  faceDescriptor: number[],
  systemId: string,
  companyId: string | undefined,
  tenantId: string | undefined,
) {
  const tenantData = await get(
    { systemId, companyId },
    "tenant-data",
  ) as Record<string, unknown> | undefined;
  const sensitivity = Number(
    tenantData?.["detection.sensitivity"] ?? 0.5,
  );
  try {
    const orphanMatch = await searchOrphanFaceByEmbedding(
      faceDescriptor,
      sensitivity,
    );
    if (orphanMatch.length > 0) {
      await linkOrphanFaceToLead(orphanMatch[0].id, leadId);
    } else {
      await tryUpsertFace({
        leadId,
        embedding_type1: faceDescriptor,
      }, {
        route: "systems/grex-id/leads/public:POST",
        tenantId,
      });
    }
  } catch {
    await tryUpsertFace({
      leadId,
      embedding_type1: faceDescriptor,
    }, {
      route: "systems/grex-id/leads/public:POST",
      tenantId,
    });
  }
}

async function postHandler(req: Request, ctx: RequestContext) {
  let body: Record<string, unknown> | null = null;
  try {
    let parsedBody: Record<string, unknown>;
    try {
      parsedBody = await req.json() as Record<string, unknown>;
    } catch {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: ["validation.json.invalid"],
          },
        },
        { status: 400 },
      );
    }
    body = parsedBody;
    const companyId = parsedBody.companyId as string | undefined;
    const botToken = parsedBody.botToken as string | undefined;
    const profile = parsedBody.profile as
      | { name?: string; avatarUri?: string; dateOfBirth?: string }
      | undefined;
    const systemSlug = "grex-id";
    const termsAccepted = Boolean(parsedBody.termsAccepted);
    const locale = parsedBody.locale as string | undefined;
    const faceDescriptor = parsedBody.faceDescriptor as number[] | undefined;
    const avatarUri = parsedBody.avatarUri as string | undefined;
    const tags = Array.isArray(parsedBody.tags) ? parsedBody.tags : undefined;
    const acceptsCommunication = Boolean(parsedBody.acceptsCommunication);
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
    if (!profile?.name) {
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

    if (!companyId) {
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

    const systemResult = await genericList<{ id: string }>({
      table: "system",
      select: "id",
      extraConditions: ["slug = $slug"],
      extraBindings: { slug: systemSlug },
      extraAccessFields: ["id"],
      limit: 1,
      allowRawExtraConditions: true,
      allowSensitiveGlobalRead: true,
    });
    const systemId = systemResult.items[0]?.id ?? null;

    if (!systemId) {
      return Response.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "common.error.systemNotFound" },
        },
        { status: 404 },
      );
    }

    const csTenantId = await ensureCompanySystemTenant({ companyId, systemId });

    const mergedProfile = profile
      ? {
        ...profile,
        avatarUri: avatarUri ?? profile.avatarUri,
      }
      : avatarUri
      ? { avatarUri }
      : undefined;

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

    const existing = await findLeadByChannelValues(
      channels.map((c) => c.value),
    );

    if (existing) {
      const guardResult = await communicationGuard({
        ownerId: existing.id,
        ownerType: "lead",
        actionKey: "auth.action.leadUpdate",
        payload: {
          changes: [
            {
              action: "update",
              actionKey: "auth.action.leadUpdate",
              entity: "lead",
              id: existing.id,
              fields: {
                name: name ?? undefined,
                profile: mergedProfile,
                tags,
              },
            },
            ...(channels?.length
              ? [{
                action: "custom" as const,
                actionKey: "auth.action.leadUpdate",
                entity: "lead" as const,
                id: existing.id,
                fields: { syncChannels: channels },
              }]
              : []),
            ...([csTenantId].length > 0
              ? [{
                action: "custom" as const,
                actionKey: "auth.action.leadUpdate",
                entity: "lead" as const,
                id: existing.id,
                fields: { associateTenants: [csTenantId] },
              }]
              : []),
          ],
          hooks: {
            faceDescriptor: Array.isArray(faceDescriptor)
              ? faceDescriptor
              : undefined,
            systemId,
            systemSlug,
          },
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

      const settingScope = systemId ? { systemId } : undefined;
      const expiryMinutes = Number(
        (await get(
          settingScope,
          "setting.auth.communication.expiry.minutes",
        )) || 15,
      );
      const baseUrl = (await get(settingScope, "setting.app.baseUrl")) ??
        "http://localhost:3000";
      const confirmationLink =
        `${baseUrl}/verify?token=${guardResult.token}&systemSlug=${
          encodeURIComponent(systemSlug)
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

    // New lead
    const lead = await createLead({
      name: name!,
      profile: mergedProfile as {
        name: string;
        avatarUri?: string;
        dateOfBirth?: string;
      },
      channels,
      tenantIds: [csTenantId],
      tags,
      acceptsCommunication,
    });

    const alreadyAssociated = ((await genericCount({
      table: "lead",
      tenant: { id: csTenantId },
      extraConditions: ["id = $leadId"],
      extraBindings: { leadId: rid(lead.id) },
      extraAccessFields: ["id"],
      allowRawExtraConditions: true,
    })) as number) > 0;
    if (!alreadyAssociated) {
      await genericAssociate({ table: "lead" }, lead.id, {
        id: csTenantId,
      });
    }

    // Handle face biometrics
    if (faceDescriptor && Array.isArray(faceDescriptor)) {
      await handleFaceBiometrics(
        lead.id,
        faceDescriptor,
        systemId,
        ctx.tenantContext?.tenant?.companyId,
        ctx.tenantContext.tenant.id,
      );
    }

    // Send verification for new lead channels
    const rawChannelIds = lead.channelIds ?? [];
    const channelIdsArr = rawChannelIds instanceof Set
      ? [...rawChannelIds]
      : Array.isArray(rawChannelIds)
      ? rawChannelIds
      : [];
    const channelIds = channelIdsArr
      .map((c: unknown) =>
        typeof c === "string" ? c : String((c as { id?: string }).id ?? "")
      )
      .filter((s) => s.length > 0);

    const guardResult = await communicationGuard({
      ownerId: lead.id,
      ownerType: "lead",
      actionKey: "auth.action.leadRegister",
      payload: {
        changes: channelIds.map((id: string) => ({
          action: "update" as const,
          actionKey: "auth.action.leadRegister",
          entity: "entity_channel",
          id,
          fields: { verified: true },
        })),
      },
      tenant: {
        tenantIds: [ctx.tenantContext.tenant.id!],
        systemSlug,
      },
    });

    if (guardResult.allowed) {
      const settingScope = systemId ? { systemId } : undefined;
      const expiryMinutes = Number(
        (await get(
          settingScope,
          "setting.auth.communication.expiry.minutes",
        )) || 15,
      );
      const baseUrl = (await get(settingScope, "setting.app.baseUrl")) ??
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
          companyId,
          systemId,
          requiresVerification: true,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("grex-id leads/public error:", {
      companyId: body?.companyId,
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

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 10 },
  }),
  async (req, ctx) => postHandler(req, ctx),
);
