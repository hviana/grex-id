import type { Surreal } from "surrealdb";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("003_default_front_settings");

interface DefaultFrontSetting {
  key: string;
  value: string;
  description: string;
}

const defaults: DefaultFrontSetting[] = [
  {
    key: "front.app.name",
    value: "Core",
    description: "Application display name shown in tab titles and headers",
  },
  {
    key: "front.app.brandPrimaryColor",
    value: "#02d07d",
    description: "Primary brand color for runtime theming",
  },
  {
    key: "front.support.email",
    value: "support@core.com",
    description: "Support contact email shown in footer",
  },
  {
    key: "front.support.helpUrl",
    value: "",
    description: "Help Center link URL",
  },
  {
    key: "front.botProtection.siteKey",
    value: "",
    description: "CAPTCHA / bot-protection client key",
  },
  {
    key: "front.payment.publicKey",
    value: "",
    description: "Payment gateway publishable key",
  },
  {
    key: "front.dataTracking.trackedCharacteristics",
    value: "[]",
    description:
      "JSON array of user characteristics that MUST NOT be tracked unless the data-tracking consent popup has been accepted. Seeded empty; additive — frameworks may introduce new characteristic names without core changes.",
  },
];

export async function seed(db: Surreal): Promise<void> {
  const tenantResult = await db.query<[{ id: string }[]]>(
    `SELECT id FROM tenant WHERE actorId IS NONE AND companyId IS NONE AND systemId = (SELECT id FROM system WHERE slug = "core" LIMIT 1).id LIMIT 1`,
  );
  const tenantId = tenantResult[0]?.[0]?.id;
  if (!tenantId) {
    console.log("[seed] core system tenant not found, skipping front settings");
    return;
  }

  for (const setting of defaults) {
    const existing = await db.query<[{ id: string }[]]>(
      `SELECT id FROM front_setting WHERE key = $key AND tenantId = $tenantId LIMIT 1`,
      { key: setting.key, tenantId },
    );
    if ((existing[0] ?? []).length > 0) continue;
    await db.query(
      `CREATE front_setting SET
        key = $key,
        value = $value,
        description = $description,
        tenantId = $tenantId`,
      {
        key: setting.key,
        value: setting.value,
        description: setting.description,
        tenantId,
      },
    );
    console.log(`[seed] front setting created: ${setting.key}`);
  }
}
