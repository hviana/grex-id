import type { Surreal } from "surrealdb";

interface DefaultSetting {
  key: string;
  value: string;
  description: string;
}

const defaults: DefaultSetting[] = [
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
    key: "communication.email.provider",
    value: "",
    description: "Email provider configuration (JSON)",
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
    key: "communication.sms.provider",
    value: "",
    description: "SMS provider configuration (JSON)",
  },
  {
    key: "payment.provider",
    value: "",
    description: "Payment provider configuration (JSON)",
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
    key: "communication.email.senders",
    value: '["noreply@core.com"]',
    description: "JSON array of default email sender addresses",
  },
  {
    key: "terms.generic",
    value: "",
    description:
      "Generic LGPD/terms of service HTML content (fallback when system has no specific terms)",
  },
];

export async function seedDefaultSettings(db: Surreal): Promise<void> {
  for (const setting of defaults) {
    const existing = await db.query<[{ id: string }[]]>(
      "SELECT id FROM core_setting WHERE key = $key LIMIT 1",
      { key: setting.key },
    );

    if (existing[0] && existing[0].length > 0) continue;

    await db.query(
      `CREATE core_setting SET
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
