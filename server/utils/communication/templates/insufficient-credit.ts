import { t } from "@/src/i18n";
import type { TemplateResult } from "@/src/contracts/communication";
import { emailLayout } from "./layout.ts";

export function insufficientCreditTemplate(
  locale: string,
  data: {
    name: string;
    systemName: string;
    resourceKey: string;
    purchaseLink: string;
  },
): TemplateResult {
  const translatedResource = t(data.resourceKey, locale) !== data.resourceKey
    ? t(data.resourceKey, locale)
    : data.resourceKey.split(".").pop() ?? data.resourceKey;

  const content = `
    <!-- Warning icon with glow effect -->
    <tr>
      <td style="padding: 0 0 8px 0; text-align: center;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
          <tr>
            <td style="width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, rgba(255, 99, 71, 0.15) 0%, rgba(255, 165, 0, 0.10) 100%); text-align: center; vertical-align: middle; border: 1px solid rgba(255, 99, 71, 0.25);">
              <span style="font-size: 40px; line-height: 80px;">&#x26A0;&#xFE0F;</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Title -->
    <tr>
      <td style="padding: 16px 0 8px 0; font-size: 22px; font-weight: 700; color: #ffffff; text-align: center; letter-spacing: -0.3px;">
        ${t("templates.insufficientCredit.title", locale)}
      </td>
    </tr>

    <!-- Greeting -->
    <tr>
      <td style="padding: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #cccccc; text-align: center;">
        ${
    t("templates.insufficientCredit.greeting", locale, { name: data.name })
  }
      </td>
    </tr>

    <!-- Divider -->
    <tr>
      <td style="padding: 0 0 24px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="height: 1px; background: linear-gradient(90deg, transparent 0%, #333333 20%, #ff6347 50%, #333333 80%, transparent 100%); font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Info card: system + resource -->
    <tr>
      <td style="padding: 0 0 24px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: rgba(255, 99, 71, 0.06); border: 1px solid rgba(255, 99, 71, 0.15); border-radius: 12px;">
          <tr>
            <td style="padding: 20px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <!-- System row -->
                <tr>
                  <td style="padding: 0 0 12px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #888888; padding: 0 0 4px 0;">
                          ${
    t("templates.insufficientCredit.systemLabel", locale)
  }
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size: 15px; font-weight: 600; color: #ffffff;">
                          ${data.systemName}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <!-- Separator -->
                <tr>
                  <td style="height: 1px; background-color: rgba(255, 255, 255, 0.06); font-size: 0; line-height: 0;">&nbsp;</td>
                </tr>
                <!-- Resource row -->
                <tr>
                  <td style="padding: 12px 0 0 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #888888; padding: 0 0 4px 0;">
                          ${
    t("templates.insufficientCredit.resourceLabel", locale)
  }
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size: 15px; font-weight: 600; color: #ff6347;">
                          ${translatedResource}
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

    <!-- Explanation text -->
    <tr>
      <td style="padding: 0 0 32px 0; font-size: 14px; line-height: 1.7; color: #aaaaaa; text-align: center;">
        ${t("templates.insufficientCredit.body", locale)}
      </td>
    </tr>

    <!-- CTA Button -->
    <tr>
      <td style="padding: 0 0 24px 0; text-align: center;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
          <tr>
            <td style="border-radius: 10px; background-image: linear-gradient(135deg, #02d07d 0%, #00ccff 100%); background-color: #02d07d; text-align: center;">
              <a href="${data.purchaseLink}" target="_blank" style="display: inline-block; padding: 16px 48px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 700; color: #000000; text-decoration: none; border-radius: 10px; letter-spacing: 0.3px;">
                <!--[if mso]><i style="mso-font-width: 200%; mso-text-raise: 21pt;">&nbsp;</i><![endif]-->
                <span style="mso-text-raise: 10pt;">${
    t("templates.insufficientCredit.action", locale)
  }</span>
                <!--[if mso]><i style="mso-font-width: 200%;">&nbsp;</i><![endif]-->
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Renewal notice -->
    <tr>
      <td style="padding: 0 0 8px 0; text-align: center;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
          <tr>
            <td style="padding: 14px 24px; background-color: rgba(2, 208, 125, 0.06); border: 1px solid rgba(2, 208, 125, 0.15); border-radius: 10px;">
              <span style="font-size: 13px; line-height: 1.5; color: #02d07d;">
                &#x1F504; ${
    t("templates.insufficientCredit.renewalNote", locale)
  }
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  return {
    title: t("templates.insufficientCredit.subject", locale, {
      systemName: data.systemName,
    }),
    body: emailLayout(
      content,
      locale,
      t("templates.insufficientCredit.preheader", locale),
    ),
  };
}
