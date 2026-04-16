import { t } from "@/src/i18n";
import type { TemplateResult } from "@/src/contracts/communication";
import { emailLayout } from "./layout.ts";

export function paymentFailureTemplate(
  locale: string,
  data: {
    name: string;
    systemName: string;
    kind: string;
    amount: string;
    currency: string;
    reason: string;
    billingUrl: string;
  },
): TemplateResult {
  const kindSummaryKey = data.kind === "recurring"
    ? "templates.paymentFailure.summaryRecurring"
    : data.kind === "credits"
    ? "templates.paymentFailure.summaryCredits"
    : "templates.paymentFailure.summaryAutoRecharge";

  const kindDetailLabelKey = data.kind === "recurring"
    ? "templates.paymentFailure.planRenewal"
    : data.kind === "credits"
    ? "templates.paymentFailure.creditPurchase"
    : "templates.paymentFailure.autoRechargeLabel";

  const content = `
    <!-- Warning icon with glow -->
    <tr>
      <td style="padding: 0 0 8px 0; text-align: center;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
          <tr>
            <td style="width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, rgba(255, 99, 71, 0.18) 0%, rgba(255, 165, 0, 0.12) 100%); text-align: center; vertical-align: middle; border: 1px solid rgba(255, 99, 71, 0.3);">
              <span style="font-size: 40px; line-height: 80px;">&#x26A0;&#xFE0F;</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Title -->
    <tr>
      <td style="padding: 16px 0 8px 0; font-size: 22px; font-weight: 700; color: #ffffff; text-align: center; letter-spacing: -0.3px;">
        ${t("templates.paymentFailure.title", locale)}
      </td>
    </tr>

    <!-- Greeting -->
    <tr>
      <td style="padding: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #cccccc; text-align: center;">
        ${t("templates.paymentFailure.greeting", locale, { name: data.name })}
      </td>
    </tr>

    <!-- Summary -->
    <tr>
      <td style="padding: 0 0 28px 0; font-size: 14px; line-height: 1.7; color: #aaaaaa; text-align: center;">
        ${t(kindSummaryKey, locale, { systemName: data.systemName })}
      </td>
    </tr>

    <!-- Warning divider -->
    <tr>
      <td style="padding: 0 0 24px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="height: 1px; background: linear-gradient(90deg, transparent 0%, #333333 20%, #ff6347 50%, #333333 80%, transparent 100%); font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Facts card (warning-styled) -->
    <tr>
      <td style="padding: 0 0 32px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: rgba(255, 99, 71, 0.06); border: 1px solid rgba(255, 99, 71, 0.15); border-radius: 12px;">
          <tr>
            <td style="padding: 20px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <!-- Amount row -->
                <tr>
                  <td style="padding: 0 0 12px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #888888; padding: 0 0 4px 0;">
                          ${t("templates.paymentFailure.amountLabel", locale)}
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size: 20px; font-weight: 700; color: #ff6347;">
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
                          ${t("templates.paymentFailure.typeLabel", locale)}
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
                  <td style="padding: 12px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #888888; padding: 0 0 4px 0;">
                          ${t("templates.paymentFailure.systemLabel", locale)}
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
                <!-- Reason row -->
                <tr>
                  <td style="padding: 12px 0 0 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #888888; padding: 0 0 4px 0;">
                          ${t("templates.paymentFailure.reasonLabel", locale)}
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size: 15px; font-weight: 600; color: #ff6347;">
                          ${
    t(data.reason, locale) !== data.reason
      ? t(data.reason, locale)
      : data.reason
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

    <!-- Explanation text -->
    <tr>
      <td style="padding: 0 0 32px 0; font-size: 14px; line-height: 1.7; color: #aaaaaa; text-align: center;">
        ${t("templates.paymentFailure.body", locale)}
      </td>
    </tr>

    <!-- CTA Button -->
    <tr>
      <td style="padding: 0 0 24px 0; text-align: center;">
        <a href="${data.billingUrl}" target="_blank" style="display: inline-block; padding: 16px 48px; background: linear-gradient(135deg, #02d07d 0%, #00ccff 100%); color: #000000; font-size: 15px; font-weight: 700; text-decoration: none; border-radius: 10px; letter-spacing: 0.3px; mso-padding-alt: 0; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <!--[if mso]><i style="mso-font-width: 200%; mso-text-raise: 21pt;">&nbsp;</i><![endif]-->
          <span style="mso-text-raise: 10pt;">${
    t("templates.paymentFailure.cta", locale)
  }</span>
          <!--[if mso]><i style="mso-font-width: 200%;">&nbsp;</i><![endif]-->
        </a>
      </td>
    </tr>

    <!-- Urgency badge -->
    <tr>
      <td style="padding: 0 0 8px 0; text-align: center;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
          <tr>
            <td style="padding: 14px 24px; background-color: rgba(255, 99, 71, 0.08); border: 1px solid rgba(255, 99, 71, 0.15); border-radius: 10px;">
              <span style="font-size: 13px; line-height: 1.5; color: #ff6347;">
                &#x26A0;&#xFE0F; ${
    t("templates.paymentFailure.urgentNote", locale)
  }
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  return {
    title: t("templates.paymentFailure.subject", locale, {
      systemName: data.systemName,
    }),
    body: emailLayout(content, locale),
  };
}
