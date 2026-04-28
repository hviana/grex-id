import type { Surreal } from "surrealdb";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("002_default_settings");

interface DefaultSetting {
  key: string;
  value: string;
  description: string;
}

const defaults: DefaultSetting[] = [
  {
    key: "auth.jwt.secret",
    value: "dev-secret-change-in-production#234A723as472da3987GG2394",
    description:
      "Secret key for signing JWT tokens (must be changed in production)",
  },
  {
    key: "auth.encryption.key",
    value: "JX9nKHJd4rIOmW6HH0HYhBmta6NQepyUtxiaS3rnoX8=",
    description:
      "AES-256-GCM key (base64, 32 bytes) for the field encryption wrapper. DEV ONLY — override per deployment.",
  },
  {
    key: "auth.twoFactor.issuer",
    value: "Core",
    description: "Issuer name shown in authenticator apps for TOTP 2FA",
  },
  {
    key: "app.name",
    value: "Core",
    description: "Application display name",
  },
  {
    key: "auth.token.expiry.minutes",
    value: "15",
    description: "System API token expiry in minutes",
  },
  {
    key: "auth.token.expiry.stayLoggedIn.hours",
    value: "168",
    description: "Token expiry when stay-logged-in is enabled (7 days)",
  },
  {
    key: "auth.rateLimit.perMinute",
    value: "5",
    description: "Max auth requests per minute per IP",
  },
  {
    key: "auth.communication.expiry.minutes",
    value: "15",
    description:
      "Unified expiry in minutes for all verification/communication tokens",
  },
  {
    key: "auth.communication.maxCount",
    value: "5",
    description:
      "Max verification sends per user per type within the rolling window",
  },
  {
    key: "auth.communication.windowHours",
    value: "1",
    description: "Rolling window in hours for the communication rate limit",
  },
  {
    key: "auth.oauth.providers",
    value: "[]",
    description:
      "JSON array of enabled OAuth provider names. Empty = OAuth login disabled.",
  },
  {
    key: "communication.email.mailgun_apikey",
    value: "",
    description: "Mailgun API key for sending emails",
  },
  {
    key: "communication.email.mailgun_url",
    value: "",
    description:
      "Mailgun API URL (e.g. https://api.mailgun.net/v3/yourdomain.com/messages)",
  },
  {
    key: "communication.email.mailgun_from",
    value: "",
    description:
      "Mailgun sender address (e.g. App Name <noreply@yourdomain.com>)",
  },
  {
    key: "app.defaultSystem",
    value: "grex-id",
    description:
      "System slug shown on the homepage when no ?systemSlug= parameter is provided",
  },
  {
    key: "app.baseUrl",
    value: "http://localhost:3000",
    description: "Public base URL used in emails and verification links",
  },
  {
    key: "terms.generic",
    value: "",
    description:
      "Generic LGPD/terms of service HTML content (fallback when system has no specific terms)",
  },
  {
    key: "billing.autoRecharge.minAmount",
    value: "500",
    description: "Minimum auto-recharge amount in cents",
  },
  {
    key: "billing.autoRecharge.maxAmount",
    value: "50000",
    description: "Maximum auto-recharge amount per subscription in cents",
  },
  {
    key: "communication.email.senders",
    value: "[]",
    description: "JSON array of default sender email addresses",
  },
  {
    key: "auth.entityChannel.maxPerOwner",
    value: "10",
    description: "Maximum entity channels per owner (user or lead)",
  },
  {
    key: "auth.entityChannel.defaultTypes",
    value: '["email","phone"]',
    description: "JSON array of seeded channel types",
  },
  {
    key: "auth.communication.defaultChannels",
    value: '["email","sms"]',
    description:
      "JSON array of channels used by system-wide communications when the caller omits `channels`; order defines fallback precedence",
  },
  {
    key: "communication.sms.senders",
    value: "[]",
    description: "JSON array of default sender phone numbers",
  },
  {
    key: "communication.sms.provider",
    value: "",
    description: "Identifier of the SMS provider (reserved for future use)",
  },
  {
    key: "db.frontend.url",
    value: "ws://127.0.0.1:8000/rpc",
    description: "Frontend WebSocket endpoint for LIVE SELECT",
  },
  {
    key: "db.frontend.namespace",
    value: "main",
    description: "SurrealDB namespace for frontend live queries",
  },
  {
    key: "db.frontend.database",
    value: "grex-id",
    description: "SurrealDB database for frontend live queries",
  },
  {
    key: "db.frontend.user",
    value: "",
    description: "SurrealDB auth user for frontend WebSocket connection",
  },
  {
    key: "db.frontend.pass",
    value: "",
    description: "SurrealDB auth pass for frontend WebSocket connection",
  },
  {
    key: "cache.core.size",
    value: "20",
    description: "Core file cache size in megabytes",
  },
  {
    key: "cache.file.hitWindowHours",
    value: "1",
    description: "Sliding window duration for file cache hit counting (hours)",
  },
  {
    key: "transfer.default.maxConcurrentDownloads",
    value: "0",
    description: "Default max concurrent downloads per user (0 = unlimited)",
  },
  {
    key: "transfer.default.maxConcurrentUploads",
    value: "0",
    description: "Default max concurrent uploads per user (0 = unlimited)",
  },
  {
    key: "transfer.default.maxDownloadBandwidthMB",
    value: "0",
    description: "Default max download bandwidth in MB/s (0 = unlimited)",
  },
  {
    key: "transfer.default.maxUploadBandwidthMB",
    value: "0",
    description: "Default max upload bandwidth in MB/s (0 = unlimited)",
  },
  {
    key: "core.shareableEntities",
    value: '["user"]',
    description:
      "JSON array of entity types that can be shared between tenants via direct tenant association (genericAssociate/genericDisassociate)",
  },
  {
    key: "core.restrictedEntities",
    value: "[]",
    description:
      "JSON array of entity types that use shared_record with permissions (r/w/rw). These do not require human approval for sharing.",
  },
];

export async function seed(db: Surreal): Promise<void> {
  // Resolve core system-level tenant row (actorId=NONE, companyId=NONE, systemId=core)
  const tenantResult = await db.query<[{ id: string }[]]>(
    `SELECT id FROM tenant WHERE !actorId AND !companyId AND systemId = (SELECT id FROM system WHERE slug = "core" LIMIT 1)[0].id LIMIT 1`,
  );
  const tenantId = tenantResult[0]?.[0]?.id;
  if (!tenantId) {
    console.log("[seed] core system tenant not found, skipping settings");
    return;
  }

  for (const setting of defaults) {
    const existing = await db.query<[{ id: string }[]]>(
      `SELECT id FROM setting WHERE key = $key AND tenantIds CONTAINS $tenantId LIMIT 1`,
      { key: setting.key, tenantId },
    );
    if ((existing[0] ?? []).length > 0) continue;
    await db.query(
      `CREATE setting SET
        key = $key,
        value = $value,
        description = $description,
        tenantIds = [$tenantId]`,
      {
        key: setting.key,
        value: setting.value,
        description: setting.description,
        tenantId,
      },
    );
    console.log(`[seed] setting created: ${setting.key}`);
  }
}
