import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high_level/tenant-context";
import {
  findUserByVerifiedChannel,
  resolveUserMembership,
  userHasVerifiedChannel,
} from "@/server/db/queries/auth";
import { createTenantToken } from "@/server/utils/token";
import Core from "@/server/utils/Core";
import { genericDecrypt, genericVerify } from "@/server/db/queries/generics";
import { standardizeField } from "@/server/utils/field-standardizer";
import { rememberActor } from "@/server/utils/actor-validity";
import { NobleCryptoPlugin, ScureBase32Plugin, TOTP } from "otplib";

function guessChannelType(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "email";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 10 && digits.length <= 15) return "phone";
  return undefined;
}

async function handler(
  req: Request,
  _ctx: RequestContext,
): Promise<Response> {
  const body = await req.json();
  const { password, stayLoggedIn, identifier, twoFactorCode } = body as {
    password?: string;
    stayLoggedIn?: boolean;
    identifier?: string;
    twoFactorCode?: string;
  };

  if (!identifier || typeof identifier !== "string" || !password) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["validation.identifier.required"],
        },
      },
      { status: 400 },
    );
  }

  const channelType = guessChannelType(identifier);
  const value = channelType
    ? await standardizeField(channelType, identifier, "entity_channel")
    : identifier.trim();

  const user = await findUserByVerifiedChannel(value, channelType);
  if (!user) {
    return Response.json(
      {
        success: false,
        error: {
          code: "AUTH_FAILED",
          message: "auth.error.invalidCredentials",
        },
      },
      { status: 401 },
    );
  }

  const passwordValid = await genericVerify(
    { table: "user", hashField: "passwordHash" },
    String(user.id),
    password,
  );
  if (!passwordValid) {
    return Response.json(
      {
        success: false,
        error: {
          code: "AUTH_FAILED",
          message: "auth.error.invalidCredentials",
        },
      },
      { status: 401 },
    );
  }

  const approved = await userHasVerifiedChannel(String(user.id));
  if (!approved) {
    return Response.json(
      {
        success: false,
        error: {
          code: "NOT_VERIFIED",
          message: "auth.error.notVerified",
        },
      },
      { status: 403 },
    );
  }

  if (user.twoFactorEnabled) {
    if (!twoFactorCode) {
      return Response.json(
        {
          success: false,
          error: {
            code: "2FA_REQUIRED",
            message: "auth.error.twoFactorRequired",
          },
        },
        { status: 403 },
      );
    }

    if (user.twoFactorSecret) {
      let plainSecret: string;
      try {
        const decrypted = await genericDecrypt(
          { table: "user", decryptFields: [{ field: "twoFactorSecret" }] },
          String(user.id),
        );
        plainSecret = decrypted.twoFactorSecret ?? "";
        if (!plainSecret) throw new Error("empty");
      } catch {
        return Response.json(
          {
            success: false,
            error: {
              code: "2FA_INVALID",
              message: "auth.error.twoFactorInvalid",
            },
          },
          { status: 401 },
        );
      }
      const totp = new TOTP({
        secret: plainSecret,
        crypto: new NobleCryptoPlugin(),
        base32: new ScureBase32Plugin(),
      });
      const result = await totp.verify(twoFactorCode);
      if (!result.valid) {
        return Response.json(
          {
            success: false,
            error: {
              code: "2FA_INVALID",
              message: "auth.error.twoFactorInvalid",
            },
          },
          { status: 401 },
        );
      }
    } else {
      return Response.json(
        {
          success: false,
          error: {
            code: "2FA_INVALID",
            message: "auth.error.twoFactorInvalid",
          },
        },
        { status: 401 },
      );
    }
  }

  const mem = await resolveUserMembership(String(user.id));

  const tenant = mem
    ? {
      id: mem.tenantId,
      systemId: mem.systemId,
      companyId: mem.companyId,
      actorId: String(user.id),
    }
    : {
      id: String(user.id),
      actorId: String(user.id),
    };

  const systemToken = await createTenantToken(
    tenant,
    stayLoggedIn ?? false,
  );

  const roles = mem?.roles ?? [];

  await rememberActor(tenant);

  const frontendDomains: string[] = [];

  return Response.json({
    success: true,
    data: {
      systemToken,
      tenant,
      roles,
      actorType: "user" as const,
      exchangeable: true,
      frontendDomains,
      user: {
        id: user.id,
        profileId: user.profileId,
        channelIds: user.channelIds,
        twoFactorEnabled: user.twoFactorEnabled ?? false,
      },
    },
  });
}

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
  }),
  handler,
);
