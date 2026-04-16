import { t } from "@/src/i18n";

export function emailLayout(content: string, locale: string): string {
  return `<!DOCTYPE html>
<html lang="${locale}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title></title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    :root { color-scheme: dark; supported-color-schemes: dark; }
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #000000; }
    a { color: #02d07d; }
    a:hover { color: #00ff88; }
    @media only screen and (max-width: 600px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .fluid { max-width: 100% !important; height: auto !important; }
      .stack-column { display: block !important; width: 100% !important; max-width: 100% !important; }
      .center-on-narrow { text-align: center !important; display: block !important; margin-left: auto !important; margin-right: auto !important; float: none !important; }
      table.center-on-narrow { display: inline-block !important; }
      .padding-mobile { padding-left: 20px !important; padding-right: 20px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; word-spacing: normal; background-color: #000000;">

  <!-- Background wrapper -->
  <div role="article" aria-roledescription="email" lang="${locale}" style="text-size-adjust: 100%; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; background-color: #000000;">

    <!--[if mso | IE]>
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #000000;">
    <tr><td align="center">
    <![endif]-->

    <!-- Outer table for centering -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 auto; background-color: #000000;">
      <tr>
        <td align="center" style="padding: 32px 16px;">

          <!-- Email container -->
          <!--[if mso]>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560"><tr><td>
          <![endif]-->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="email-container" style="max-width: 560px; width: 100%; margin: 0 auto;">

            <!-- Top gradient accent line -->
            <tr>
              <td style="height: 3px; background: linear-gradient(90deg, #02d07d 0%, #00ccff 50%, #02d07d 100%); font-size: 0; line-height: 0;">&nbsp;</td>
            </tr>

            <!-- Main card -->
            <tr>
              <td style="background-color: #0d0d0d; border-left: 1px solid #1a1a1a; border-right: 1px solid #1a1a1a; padding: 48px 40px 40px 40px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;" class="padding-mobile">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  ${content}
                </table>
              </td>
            </tr>

            <!-- Bottom gradient accent line -->
            <tr>
              <td style="height: 1px; background: linear-gradient(90deg, transparent 0%, #333333 50%, transparent 100%); font-size: 0; line-height: 0;">&nbsp;</td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding: 24px 40px 32px 40px; text-align: center;" class="padding-mobile">
                <p style="margin: 0 0 8px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.5; color: #555555;">
                  ${t("templates.layout.footer", locale)}
                </p>
                <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.5; color: #333333;">
                  ${t("templates.layout.automated", locale)}
                </p>
              </td>
            </tr>

          </table>
          <!--[if mso]>
          </td></tr></table>
          <![endif]-->

        </td>
      </tr>
    </table>

    <!--[if mso | IE]>
    </td></tr></table>
    <![endif]-->

  </div>
</body>
</html>`;
}
