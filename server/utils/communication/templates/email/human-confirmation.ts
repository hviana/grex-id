import { t } from "@/src/i18n";
import type { TemplateResult } from "@/src/contracts/communication";
import type { HumanConfirmationTemplateData } from "@/src/contracts/high-level/communication-templates";
import { emailLayout, escapeHtml } from "./layout.ts";
import { assertServerOnly } from "../../../server-only.ts";

assertServerOnly("human-confirmation");

function formatOccurredAt(iso: string, locale: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString(locale === "pt-BR" ? "pt-BR" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export async function humanConfirmationEmailTemplate(
  locale: string,
  data: HumanConfirmationTemplateData,
): Promise<TemplateResult> {
  const actionName = t(data.actionKey, locale);
  const expiryMinutes = String(data.expiryMinutes ?? "15");
  const occurred = formatOccurredAt(data.occurredAt, locale);

  const content = `
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

    <tr>
      <td style="padding: 16px 0 8px 0; font-size: 22px; font-weight: 700; color: #ffffff; text-align: center; letter-spacing: -0.3px;">
        ${escapeHtml(actionName)}
      </td>
    </tr>

    <tr>
      <td style="padding: 0 0 8px 0; font-size: 15px; line-height: 1.6; color: #cccccc; text-align: center;">
        ${
    t("templates.humanConfirmation.greeting", locale, {
      name: data.actorName ??
        t("templates.humanConfirmation.anonymous", locale),
    })
  }
      </td>
    </tr>

    <tr>
      <td style="padding: 0 0 28px 0; font-size: 14px; line-height: 1.7; color: #aaaaaa; text-align: center;">
        ${t("templates.humanConfirmation.summary", locale)}
      </td>
    </tr>

    <tr>
      <td style="padding: 0 0 24px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="height: 1px; background: linear-gradient(90deg, transparent 0%, #333333 20%, #02d07d 50%, #333333 80%, transparent 100%); font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding: 0 0 32px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: rgba(2, 208, 125, 0.05); border: 1px solid rgba(2, 208, 125, 0.12); border-radius: 12px;">
          <tr>
            <td style="padding: 20px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="padding: 0 0 12px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #888888; padding: 0 0 4px 0;">
                          ${
    t("templates.humanConfirmation.occurredAtLabel", locale)
  }
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size: 15px; font-weight: 600; color: #ffffff;">
                          ${escapeHtml(occurred)}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="height: 1px; background-color: rgba(255, 255, 255, 0.06); font-size: 0; line-height: 0;">&nbsp;</td>
                </tr>
                <tr>
                  <td style="padding: 12px 0 0 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #888888; padding: 0 0 4px 0;">
                          ${
    t("templates.humanConfirmation.expiryLabel", locale)
  }
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size: 15px; font-weight: 600; color: #ffffff;">
                          ${
    t("templates.humanConfirmation.expiryValue", locale, {
      minutes: expiryMinutes,
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

    <tr>
      <td style="padding: 0 0 24px 0; text-align: center;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
          <tr>
            <td style="border-radius: 10px; background-image: linear-gradient(135deg, #02d07d 0%, #00ccff 100%); background-color: #02d07d; text-align: center;">
              <a href="${data.confirmationLink}" target="_blank" style="display: inline-block; padding: 16px 48px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 700; color: #000000; text-decoration: none; border-radius: 10px; letter-spacing: 0.3px;">
                <!--[if mso]><i style="mso-font-width: 200%; mso-text-raise: 21pt;">&nbsp;</i><![endif]-->
                <span style="mso-text-raise: 10pt;">${
    t("templates.humanConfirmation.action", locale)
  }</span>
                <!--[if mso]><i style="mso-font-width: 200%;">&nbsp;</i><![endif]-->
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding: 0 0 8px 0; font-size: 12px; line-height: 1.6; color: #777777; text-align: center;">
        ${t("templates.humanConfirmation.ignore", locale)}
      </td>
    </tr>`;

  return {
    title: t("templates.humanConfirmation.subject", locale, {
      action: actionName,
    }),
    body: await emailLayout(
      content,
      locale,
      t("templates.humanConfirmation.preheader", locale, {
        action: actionName,
      }),
      {
        actorName: data.actorName,
        companyName: data.companyName,
        systemName: data.systemName,
      },
    ),
  };
}
