import type { Surreal } from "surrealdb";

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
];

export async function seed(db: Surreal): Promise<void> {
  for (const setting of defaults) {
    await db.query(
      `CREATE front_setting SET
        key = $key,
        value = $value,
        description = $description`,
      {
        key: setting.key,
        value: setting.value,
        description: setting.description,
      },
    );
    console.log(`[seed] front setting created: ${setting.key}`);
  }
}
