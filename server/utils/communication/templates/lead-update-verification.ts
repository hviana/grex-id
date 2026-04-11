import { t } from "@/src/i18n";
import type { TemplateResult } from "@/src/contracts/communication";
import { emailLayout } from "./layout.ts";

interface LeadChange {
  field: string;
  from: string;
  to: string;
}

export function leadUpdateVerificationTemplate(
  locale: string,
  data: {
    name: string;
    verificationLink: string;
    changes: LeadChange[];
  },
): TemplateResult {
  const changesRows = data.changes
    .map(
      (change) => `
      <tr>
        <td style="padding: 10px 16px; border-bottom: 1px solid #1a1a1a;">
          <span style="display: block; font-size: 11px; font-weight: 600; color: #02d07d; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">
            ${t(`templates.leadUpdate.field.${change.field}`, locale)}
          </span>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="padding: 2px 0; font-size: 13px; color: #666666; text-decoration: line-through; word-break: break-all;">
                ${
        escapeHtml(change.from || t("templates.leadUpdate.empty", locale))
      }
              </td>
            </tr>
            <tr>
              <td style="padding: 2px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding-right: 6px; font-size: 13px; color: #02d07d; vertical-align: middle;">&#x2192;</td>
                    <td style="font-size: 13px; color: #ffffff; font-weight: 600; word-break: break-all;">
                      ${
        escapeHtml(change.to || t("templates.leadUpdate.empty", locale))
      }
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>`,
    )
    .join("");

  const content = `
    <tr>
      <td style="padding: 0 0 24px 0; text-align: center;">
        <span style="display: inline-block; font-size: 48px; line-height: 1;">&#x1F4DD;</span>
      </td>
    </tr>
    <tr>
      <td style="padding: 0 0 8px 0; font-size: 24px; font-weight: 700; color: #ffffff; text-align: center; letter-spacing: -0.5px;">
        ${t("templates.leadUpdate.greeting", locale, { name: data.name })}
      </td>
    </tr>
    <tr>
      <td style="padding: 0 0 28px 0; font-size: 15px; line-height: 1.6; color: #cccccc; text-align: center;">
        ${t("templates.leadUpdate.body", locale)}
      </td>
    </tr>
    <tr>
      <td style="padding: 0 0 28px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #0a0a0a; border: 1px solid #1a1a1a; border-radius: 8px; overflow: hidden;">
          <tr>
            <td style="padding: 12px 16px; background-color: #111111; border-bottom: 1px solid #1a1a1a;">
              <span style="font-size: 13px; font-weight: 700; color: #888888; text-transform: uppercase; letter-spacing: 0.5px;">
                ${t("templates.leadUpdate.changesTitle", locale)}
              </span>
            </td>
          </tr>
          ${changesRows}
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding: 0 0 12px 0; font-size: 14px; line-height: 1.6; color: #cccccc; text-align: center;">
        ${t("templates.leadUpdate.confirmPrompt", locale)}
      </td>
    </tr>
    <tr>
      <td style="padding: 0 0 32px 0; text-align: center;">
        <a href="${data.verificationLink}" target="_blank" style="display: inline-block; padding: 14px 40px; background: linear-gradient(135deg, #02d07d, #00ccff); color: #000000; font-size: 15px; font-weight: 700; text-decoration: none; border-radius: 8px; letter-spacing: 0.3px; mso-padding-alt: 0; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <!--[if mso]><i style="mso-font-width: 200%; mso-text-raise: 21pt;">&nbsp;</i><![endif]-->
          <span style="mso-text-raise: 10pt;">${
    t("templates.leadUpdate.action", locale)
  }</span>
          <!--[if mso]><i style="mso-font-width: 200%;">&nbsp;</i><![endif]-->
        </a>
      </td>
    </tr>
    <tr>
      <td style="padding: 0 0 24px 0; text-align: center;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
          <tr>
            <td style="padding: 12px 20px; background-color: rgba(2, 208, 125, 0.08); border: 1px solid #1a3a2a; border-radius: 8px;">
              <span style="font-size: 13px; color: #02d07d;">&#x23F1; ${
    t("templates.leadUpdate.expiry", locale)
  }</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding: 16px 0 0 0; border-top: 1px solid #222222;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
          <tr>
            <td style="padding: 16px 20px; text-align: center;">
              <span style="font-size: 13px; line-height: 1.5; color: #888888; font-style: italic;">${
    t("templates.leadUpdate.ignore", locale)
  }</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  return {
    title: t("templates.leadUpdate.subject", locale),
    body: emailLayout(content, locale),
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
