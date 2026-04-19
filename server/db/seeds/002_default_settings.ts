import type { Surreal } from "surrealdb";

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
    key: "auth.verification.expiry.minutes",
    value: "15",
    description: "Email verification link expiry in minutes",
  },
  {
    key: "auth.passwordReset.expiry.minutes",
    value: "30",
    description: "Password reset link expiry in minutes",
  },
  {
    key: "auth.verification.cooldown.seconds",
    value: "120",
    description: "Minimum interval between verification emails",
  },
  {
    key: "auth.twoFactor.enabled",
    value: "true",
    description: "Allow users to enable two-factor authentication",
  },
  {
    key: "auth.oauth.enabled",
    value: "false",
    description: "Enable OAuth login providers",
  },
  {
    key: "auth.oauth.providers",
    value: "[]",
    description: "JSON array of enabled OAuth provider names",
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
    key: "files.maxUploadSizeBytes",
    value: "52428800",
    description: "Maximum file upload size in bytes (50MB)",
  },
  {
    key: "app.defaultSystem",
    value: "",
    description:
      "System slug shown on the homepage when no ?system= parameter is provided",
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
    key: "files.publicUpload.rateLimit.perMinute",
    value: "3",
    description: "Strict per-IP rate limit for unauthenticated file uploads",
  },
  {
    key: "files.publicUpload.maxSizeBytes",
    value: "2097152",
    description: "Max size for unauthenticated uploads (2 MB)",
  },
  {
    key: "files.publicUpload.allowedExtensions",
    value: '[".svg",".png",".jpg",".jpeg",".webp"]',
    description: "JSON array of allowed file extensions for unauthenticated uploads",
  },
  {
    key: "files.publicUpload.allowedPathPatterns",
    value: '["*/*/*/logos/*"]',
    description: "JSON array of glob patterns for allowed unauthenticated upload paths",
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
    key: "auth.recoveryChannel.maxPerUser",
    value: "10",
    description: "Maximum recovery channels per user",
  },
  {
    key: "auth.recoveryChannel.verification.expiry.minutes",
    value: "15",
    description: "Recovery channel verification link expiry in minutes",
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
];

export async function seedDefaultSettings(db: Surreal): Promise<void> {
  for (const setting of defaults) {
    const existing = await db.query<[{ id: string }[]]>(
      "SELECT id FROM setting WHERE key = $key AND systemSlug IS NONE LIMIT 1",
      { key: setting.key },
    );

    if (existing[0] && existing[0].length > 0) continue;

    await db.query(
      `CREATE setting SET
        key = $key,
        value = $value,
        description = $description`,
      {
        key: setting.key,
        value: setting.value,
        description: setting.description,
      },
    );

    console.log(`[seed] setting created: ${setting.key}`);
  }
}
