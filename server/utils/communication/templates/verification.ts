import { t } from "@/src/i18n";
import type { TemplateResult } from "@/src/contracts/communication";
import { emailLayout } from "./layout";

export function verificationTemplate(
  locale: string,
  data: { name: string; verificationLink: string },
): TemplateResult {
  const content = `
    <tr>
      <td style="padding: 0 0 24px 0; text-align: center;">
        <span style="display: inline-block; font-size: 48px; line-height: 1;">&#x2709;</span>
      </td>
    </tr>
    <tr>
      <td style="padding: 0 0 8px 0; font-size: 24px; font-weight: 700; color: #ffffff; text-align: center; letter-spacing: -0.5px;">
        ${t("templates.verification.greeting", locale, { name: data.name })}
      </td>
    </tr>
    <tr>
      <td style="padding: 0 0 32px 0; font-size: 15px; line-height: 1.6; color: #cccccc; text-align: center;">
        ${t("templates.verification.body", locale)}
      </td>
    </tr>
    <tr>
      <td style="padding: 0 0 32px 0; text-align: center;">
        <a href="${data.verificationLink}" target="_blank" style="display: inline-block; padding: 14px 40px; background: linear-gradient(135deg, #02d07d, #00ccff); color: #000000; font-size: 15px; font-weight: 700; text-decoration: none; border-radius: 8px; letter-spacing: 0.3px; mso-padding-alt: 0; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <!--[if mso]><i style="mso-font-width: 200%; mso-text-raise: 21pt;">&nbsp;</i><![endif]-->
          <span style="mso-text-raise: 10pt;">${
    t("templates.verification.action", locale)
  }</span>
          <!--[if mso]><i style="mso-font-width: 200%;">&nbsp;</i><![endif]-->
        </a>
      </td>
    </tr>
    <tr>
      <td style="padding: 0 0 16px 0; text-align: center;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
          <tr>
            <td style="padding: 12px 20px; background-color: rgba(2, 208, 125, 0.08); border: 1px solid #1a3a2a; border-radius: 8px;">
              <span style="font-size: 13px; color: #02d07d;">&#x23F1; ${
    t("templates.verification.expiry", locale)
  }</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  return {
    title: t("templates.verification.subject", locale, { name: data.name }),
    body: emailLayout(content, locale),
  };
}
