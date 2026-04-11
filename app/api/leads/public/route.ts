import { NextRequest, NextResponse } from "next/server";
import {
  associateLeadWithCompanySystem,
  createLead,
  findLeadByEmailOrPhone,
  isLeadAssociated,
} from "@/server/db/queries/leads";
import {
  createVerificationRequest,
  getLastVerificationRequest,
} from "@/server/db/queries/auth";
import { checkDuplicates } from "@/server/utils/entity-deduplicator";
import { publish } from "@/server/event-queue/publisher";
import { getDb } from "@/server/db/connection";
import Core from "@/server/utils/Core";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> | null = null;
  try {
    const parsedBody:any = await req.json() as Record<string, unknown>;
    body = parsedBody;
    const companyIds:any = Array.isArray(parsedBody.companyIds)
      ? [
        ...new Set(
          parsedBody.companyIds.filter((companyId:any): companyId is string =>
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
    const email = parsedBody.email
      ? standardizeField("email", parsedBody.email, "lead")
      : undefined;
    const phone = parsedBody.phone
      ? standardizeField("phone", parsedBody.phone, "lead")
      : undefined;
    const name = parsedBody.name
      ? standardizeField("name", parsedBody.name, "lead")
      : undefined;

    if (!botToken) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "BOT_CHECK", message: "common.error.botCheck" },
        },
        { status: 403 },
      );
    }

    if (!termsAccepted) {
      return NextResponse.json(
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

    const emailErrors = validateField("email", email, "lead");
    const nameErrors = validateField("name", name, "lead");
    const allErrors = [...emailErrors, ...nameErrors];

    if (!profile?.name || !systemSlug || allErrors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: allErrors.length > 0
              ? allErrors
              : ["validation.name.required"],
          },
        },
        { status: 400 },
      );
    }

    if (
      !companyIds || !Array.isArray(companyIds) || companyIds.length === 0
    ) {
      return NextResponse.json(
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
      return NextResponse.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "common.error.systemNotFound" },
        },
        { status: 404 },
      );
    }

    const existing = await findLeadByEmailOrPhone(email!, phone);

    if (existing) {
      // Cooldown check: prevent repeated verification requests
      const core = Core.getInstance();
      await core.ensureLoaded();
      const cooldownSeconds = parseInt(
        core.getSetting("auth.verification.cooldown.seconds") ?? "120",
        10,
      );
      const lastRequest = await getLastVerificationRequest(
        existing.id,
        "lead_update",
      );
      if (lastRequest) {
        const elapsed =
          (Date.now() - new Date(lastRequest.createdAt).getTime()) / 1000;
        if (elapsed < cooldownSeconds) {
          return NextResponse.json(
            {
              success: false,
              error: {
                code: "COOLDOWN",
                message: "validation.verification.cooldown",
              },
            },
            { status: 429 },
          );
        }
      }

      // Create verification request
      const verificationToken = crypto.randomUUID();
      const expiryMinutes = parseInt(
        core.getSetting("auth.verification.expiry.minutes") ?? "15",
        10,
      );
      await createVerificationRequest({
        userId: existing.id,
        type: "lead_update",
        token: verificationToken,
        expiresAt: new Date(Date.now() + expiryMinutes * 60_000),
        payload: {
          name: name ?? undefined,
          email: email ?? undefined,
          phone: phone ?? undefined,
          profile: mergedProfile,
          tags,
          companyIds,
          systemId,
          systemSlug,
          faceDescriptor: Array.isArray(faceDescriptor)
            ? faceDescriptor
            : undefined,
        },
      });

      // Compute changes between existing and submitted data
      const changes: { field: string; from: string; to: string }[] = [];
      if (name && name !== existing.name) {
        changes.push({ field: "name", from: existing.name ?? "", to: name });
      }
      if (email && email !== existing.email) {
        changes.push({ field: "email", from: existing.email ?? "", to: email });
      }
      if (phone && phone !== (existing.phone ?? "")) {
        changes.push({ field: "phone", from: existing.phone ?? "", to: phone });
      }
      if (
        mergedProfile?.avatarUri &&
        mergedProfile.avatarUri !== existing.profile?.avatarUri
      ) {
        changes.push({
          field: "avatarUri",
          from: existing.profile?.avatarUri ?? "",
          to: mergedProfile.avatarUri,
        });
      }

      // Publish lead update verification email
      const baseUrl = core.getSetting("app.baseUrl") ?? "http://localhost:3000";
      const verificationLink =
        `${baseUrl}/verify?token=${verificationToken}&system=${
          encodeURIComponent(systemSlug)
        }`;

      await publish("SEND_EMAIL", {
        recipients: [existing.email],
        template: "lead-update-verification",
        templateData: {
          name: existing.name ?? existing.email,
          verificationLink,
          changes,
        },
        locale: locale || undefined,
        systemSlug,
      });

      return NextResponse.json({
        success: true,
        data: {
          requiresVerification: true,
          message: "common.verificationSent",
        },
      });
    }

    const dup = await checkDuplicates("lead", [
      { field: "email", value: email! },
      { field: "phone", value: phone },
    ]);
    if (dup.isDuplicate) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "DUPLICATE",
            message: "validation.lead.duplicate",
          },
        },
        { status: 409 },
      );
    }

    const lead = await createLead({
      name: name!,
      email: email!,
      phone,
      profile: mergedProfile as any,
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

    return NextResponse.json(
      { success: true, data: { id: lead.id, requiresVerification: false } },
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
        return NextResponse.json(
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

    return NextResponse.json(
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
