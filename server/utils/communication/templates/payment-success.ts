import { t } from "@/src/i18n";
import type { TemplateResult } from "@/src/contracts/communication";
import { emailLayout } from "./layout.ts";

export function paymentSuccessTemplate(
  locale: string,
  data: {
    name: string;
    systemName: string;
    kind: string;
    amount: string;
    currency: string;
    billingUrl: string;
  },
): TemplateResult {
  const kindSummaryKey =
    data.kind === "recurring"
      ? "templates.paymentSuccess.summaryRecurring"
      : data.kind === "credits"
        ? "templates.paymentSuccess.summaryCredits"
        : "templates.paymentSuccess.summaryAutoRecharge";

  const kindDetailLabelKey =
    data.kind === "recurring"
      ? "templates.paymentSuccess.planRenewal"
      : data.kind === "credits"
        ? "templates.paymentSuccess.creditPurchase"
        : "templates.paymentSuccess.autoRechargeLabel";

  const content = `
    <!-- Hero icon with glow -->
    <tr>
      <td style="padding: 0 0 8px 0; text-align: center;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
          <tr>
            <td style="width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, rgba(2, 208, 125, 0.15) 0%, rgba(0, 204, 255, 0.10) 100%); text-align: center; vertical-align: middle; border: 1px solid rgba(2, 208, 125, 0.25);">
              <span style="font-size: 40px; line-height: 80px;">&#x1F9FE;</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Title -->
    <tr>
      <td style="padding: 16px 0 8px 0; font-size: 22px; font-weight: 700; color: #ffffff; text-align: center; letter-spacing: -0.3px;">
        ${t("templates.paymentSuccess.title", locale)}
      </td>
    </tr>

    <!-- Greeting -->
    <tr>
      <td style="padding: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #cccccc; text-align: center;">
        ${t("templates.paymentSuccess.greeting", locale, { name: data.name })}
      </td>
    </tr>

    <!-- Summary -->
    <tr>
      <td style="padding: 0 0 28px 0; font-size: 14px; line-height: 1.7; color: #aaaaaa; text-align: center;">
        ${t(kindSummaryKey, locale, { systemName: data.systemName })}
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
                <!-- Amount row -->
                <tr>
                  <td style="padding: 0 0 12px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #888888; padding: 0 0 4px 0;">
                          ${t("templates.paymentSuccess.amountLabel", locale)}
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size: 20px; font-weight: 700; color: #02d07d;">
                          ${data.currency} ${data.amount}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <!-- Separator -->
                <tr>
                  <td style="height: 1px; background-color: rgba(255, 255, 255, 0.06); font-size: 0; line-height: 0;">&nbsp;</td>
                </tr>
                <!-- Type row -->
                <tr>
                  <td style="padding: 12px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #888888; padding: 0 0 4px 0;">
                          ${t("templates.paymentSuccess.typeLabel", locale)}
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size: 15px; font-weight: 600; color: #ffffff;">
                          ${t(kindDetailLabelKey, locale)}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <!-- Separator -->
                <tr>
                  <td style="height: 1px; background-color: rgba(255, 255, 255, 0.06); font-size: 0; line-height: 0;">&nbsp;</td>
                </tr>
                <!-- System row -->
                <tr>
                  <td style="padding: 12px 0 0 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #888888; padding: 0 0 4px 0;">
                          ${t("templates.paymentSuccess.systemLabel", locale)}
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
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- CTA Button -->
    <tr>
      <td style="padding: 0 0 24px 0; text-align: center;">
        <a href="${data.billingUrl}" target="_blank" style="display: inline-block; padding: 16px 48px; background: linear-gradient(135deg, #02d07d 0%, #00ccff 100%); color: #000000; font-size: 15px; font-weight: 700; text-decoration: none; border-radius: 10px; letter-spacing: 0.3px; mso-padding-alt: 0; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <!--[if mso]><i style="mso-font-width: 200%; mso-text-raise: 21pt;">&nbsp;</i><![endif]-->
          <span style="mso-text-raise: 10pt;">${t("templates.paymentSuccess.cta", locale)}</span>
          <!--[if mso]><i style="mso-font-width: 200%;">&nbsp;</i><![endif]-->
        </a>
      </td>
    </tr>

    <!-- Confirmation badge -->
    <tr>
      <td style="padding: 0 0 8px 0; text-align: center;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
          <tr>
            <td style="padding: 12px 24px; background-color: rgba(2, 208, 125, 0.08); border: 1px solid rgba(2, 208, 125, 0.15); border-radius: 10px;">
              <span style="font-size: 13px; line-height: 1.5; color: #02d07d;">
                &#x2705; ${t("templates.paymentSuccess.confirmed", locale)}
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  return {
    title: t("templates.paymentSuccess.subject", locale, {
      systemName: data.systemName,
    }),
    body: emailLayout(content, locale),
  };
}
