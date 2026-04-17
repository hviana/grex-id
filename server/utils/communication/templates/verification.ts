import { t } from "@/src/i18n";
import type { TemplateResult } from "@/src/contracts/communication";
import { emailLayout } from "./layout.ts";

export function verificationTemplate(
  locale: string,
  data: {
    name: string;
    verificationLink: string;
    email?: string;
    expiryMinutes?: string;
  },
): TemplateResult {
  const content = `
    <!-- Hero icon with glow -->
    <tr>
      <td style="padding: 0 0 8px 0; text-align: center;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
          <tr>
            <td style="width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, rgba(2, 208, 125, 0.15) 0%, rgba(0, 204, 255, 0.10) 100%); text-align: center; vertical-align: middle; border: 1px solid rgba(2, 208, 125, 0.25);">
              <span style="font-size: 40px; line-height: 80px;">&#x2709;</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Title -->
    <tr>
      <td style="padding: 16px 0 8px 0; font-size: 22px; font-weight: 700; color: #ffffff; text-align: center; letter-spacing: -0.3px;">
        ${t("templates.verification.title", locale)}
      </td>
    </tr>

    <!-- Greeting -->
    <tr>
      <td style="padding: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #cccccc; text-align: center;">
        ${t("templates.verification.greeting", locale, { name: data.name })}
      </td>
    </tr>

    <!-- Summary -->
    <tr>
      <td style="padding: 0 0 28px 0; font-size: 14px; line-height: 1.7; color: #aaaaaa; text-align: center;">
        ${t("templates.verification.summary", locale)}
      </td>
    </tr>

    <!-- Gradient divider -->
    <tr>
      <td style="padding: 0 0 24px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="height: 1px; background: linear-gradient(90deg, transparent 0%, #333333 20%, #02d07d 50%, #333333 80%, transparent 100%); font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Facts card -->
    <tr>
      <td style="padding: 0 0 32px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: rgba(2, 208, 125, 0.05); border: 1px solid rgba(2, 208, 125, 0.12); border-radius: 12px;">
          <tr>
            <td style="padding: 20px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                ${
    data.email
      ? `<!-- Email row -->
                <tr>
                  <td style="padding: 0 0 12px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #888888; padding: 0 0 4px 0;">
                          ${t("templates.verification.emailLabel", locale)}
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size: 15px; font-weight: 600; color: #ffffff;">
                          ${data.email}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <!-- Separator -->
                <tr>
                  <td style="height: 1px; background-color: rgba(255, 255, 255, 0.06); font-size: 0; line-height: 0;">&nbsp;</td>
                </tr>`
      : ""
  }
                <!-- Expiry row -->
                <tr>
                  <td style="padding: ${data.email ? "12px" : "0"} 0 0 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #888888; padding: 0 0 4px 0;">
                          ${t("templates.verification.expiryLabel", locale)}
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size: 15px; font-weight: 600; color: #ffffff;">
                          ${
    t("templates.verification.expiryValue", locale, {
      minutes: data.expiryMinutes ?? "15",
    })
  }
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- CTA Button -->
    <tr>
      <td style="padding: 0 0 24px 0; text-align: center;">
        <a href="${data.verificationLink}" target="_blank" style="display: inline-block; padding: 16px 48px; background: linear-gradient(135deg, #02d07d 0%, #00ccff 100%); color: #000000; font-size: 15px; font-weight: 700; text-decoration: none; border-radius: 10px; letter-spacing: 0.3px; mso-padding-alt: 0; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <!--[if mso]><i style="mso-font-width: 200%; mso-text-raise: 21pt;">&nbsp;</i><![endif]-->
          <span style="mso-text-raise: 10pt;">${
    t("templates.verification.action", locale)
  }</span>
          <!--[if mso]><i style="mso-font-width: 200%;">&nbsp;</i><![endif]-->
        </a>
      </td>
    </tr>`;

  return {
    title: t("templates.verification.subject", locale, { name: data.name }),
    body: emailLayout(
      content,
      locale,
      t("templates.verification.preheader", locale),
    ),
  };
}
