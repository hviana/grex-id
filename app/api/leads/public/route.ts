import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  associateLeadWithCompanySystem,
  createLead,
  findLeadByChannelValues,
  isLeadAssociated,
} from "@/server/db/queries/leads";
import { publish } from "@/server/event-queue/publisher";
import { getDb } from "@/server/db/connection";
import Core from "@/server/utils/Core";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { communicationGuard } from "@/server/utils/verification-guard";

interface SubmittedChannel {
  type: string;
  value: string;
}

function parseChannels(raw: unknown): SubmittedChannel[] {
  if (!Array.isArray(raw)) return [];
  const out: SubmittedChannel[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const t = (entry as { type?: unknown }).type;
    const v = (entry as { value?: unknown }).value;
    if (typeof t !== "string" || typeof v !== "string") continue;
    const std = standardizeField(t, v, "entity_channel");
    if (std.length === 0) continue;
    out.push({ type: t, value: std });
  }
  return out;
}

async function postHandler(req: Request, _ctx: RequestContext) {
  let body: Record<string, unknown> | null = null;
  try {
    const parsedBody = await req.json() as Record<string, unknown>;
    body = parsedBody;
    const companyIds: string[] = Array.isArray(parsedBody.companyIds)
      ? [
        ...new Set(
          parsedBody.companyIds.filter((
            companyId: unknown,
          ): companyId is string =>
            typeof companyId === "string" && companyId.trim().length > 0
          ),
        ),
      ]
      : [];
    const botToken = parsedBody.botToken as string | undefined;
    const profile = parsedBody.profile as
      | { name?: string; avatarUri?: string; age?: number }
      | undefined;
    const systemSlug = parsedBody.systemSlug as string | undefined;
    const termsAccepted = Boolean(parsedBody.termsAccepted);
    const locale = parsedBody.locale as string | undefined;
    const faceDescriptor = parsedBody.faceDescriptor as number[] | undefined;
    const avatarUri = parsedBody.avatarUri as string | undefined;
    const tags = Array.isArray(parsedBody.tags) ? parsedBody.tags : undefined;
    const channels = parseChannels(parsedBody.channels);
    const name = parsedBody.name
      ? standardizeField("name", String(parsedBody.name), "lead")
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
      ...validateField("name", name, "lead"),
    ];
    for (const ch of channels) {
      errors.push(...validateField(ch.type, ch.value, "entity_channel"));
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

    if (!companyIds || companyIds.length === 0) {
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

    const db = await getDb();
    const systemResult = await db.query<[{ id: string }[]]>(
      "SELECT id FROM system WHERE slug = $slug LIMIT 1",
      { slug: systemSlug },
    );
    const systemId = systemResult[0]?.[0]?.id;

    if (!systemId) {
      return Response.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "common.error.systemNotFound" },
        },
        { status: 404 },
      );
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
          companyIds,
          systemId,
          systemSlug,
          faceDescriptor: Array.isArray(faceDescriptor)
            ? faceDescriptor
            : undefined,
        },
        tenant: { systemSlug, actorType: "anonymous" },
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
      const expiryMinutes = Number(
        (await core.getSetting(
          "auth.communication.expiry.minutes",
          systemSlug,
        )) || 15,
      );
      const baseUrl = (await core.getSetting("app.baseUrl", systemSlug)) ??
        "http://localhost:3000";
      const confirmationLink =
        `${baseUrl}/verify?token=${guardResult.token}&system=${
          encodeURIComponent(systemSlug ?? "")
        }`;

      const channelOrder = [...new Set(channels.map((c) => c.type))];

      await publish("send_communication", {
        channels: channelOrder,
        recipients: [existing.id],
        template: "human-confirmation",
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
        age?: number;
      },
      channels,
      companyIds,
      tags,
    });

    for (const companyId of companyIds) {
      const alreadyAssociated = await isLeadAssociated(
        lead.id,
        companyId,
        systemId,
      );
      if (!alreadyAssociated) {
        await associateLeadWithCompanySystem({
          leadId: lead.id,
          companyId,
          systemId,
        });
      }
    }

    // Gather the newly-created channel ids for the confirmation payload.
    const channelIds = (lead.channels ?? [])
      .map((c: unknown) =>
        typeof c === "string" ? c : String((c as { id?: string }).id ?? "")
      )
      .filter((s) => s.length > 0);

    const guardResult = await communicationGuard({
      ownerId: lead.id,
      ownerType: "lead",
      actionKey: "auth.action.leadRegister",
      payload: { channelIds },
      tenant: { systemSlug, actorType: "anonymous" },
    });

    if (guardResult.allowed) {
      const core = Core.getInstance();
      const expiryMinutes = Number(
        (await core.getSetting(
          "auth.communication.expiry.minutes",
          systemSlug,
        )) || 15,
      );
      const baseUrl = (await core.getSetting("app.baseUrl", systemSlug)) ??
        "http://localhost:3000";
      const confirmationLink = `${baseUrl}/verify?token=${guardResult.token}`;

      const channelOrder = [...new Set(channels.map((c) => c.type))];

      await publish("send_communication", {
        channels: channelOrder,
        recipients: [lead.id],
        template: "human-confirmation",
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
      { success: true, data: { id: lead.id, requiresVerification: true } },
      { status: 201 },
    );
  } catch (err) {
    console.error("Public lead route error:", {
      companyIds: body?.companyIds,
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
  withRateLimit({ windowMs: 60_000, maxRequests: 10 }),
  async (req, _ctx) => postHandler(req, _ctx),
);
