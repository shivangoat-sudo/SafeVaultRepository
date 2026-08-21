import nodemailer from "nodemailer";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const SAFEVAULT_LOGO_URL =
  "https://izwosuzoebfsvnkprtii.supabase.co/storage/v1/object/public/app-assets/safevault-logo.png";

function getSmtpConfig() {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER || "safevaultcheck@gmail.com";
  const pass = process.env.SMTP_PASSWORD;
  const fromEmail = process.env.SMTP_FROM || user;

  return { host, port, user, pass, fromEmail };
}

export function isEmailConfigured(): { configured: boolean; reason?: string } {
  const { pass, user, host } = getSmtpConfig();
  if (!user || !user.includes("@")) {
    return { configured: false, reason: "SMTP_USER is niet geconfigureerd of bevat geen geldig e-mailadres." };
  }
  if (!pass || pass.trim() === "") {
    return { configured: false, reason: "SMTP_PASSWORD is niet ingesteld in de omgevingsvariabelen." };
  }
  if (!host) {
    return { configured: false, reason: "SMTP_HOST is niet geconfigureerd." };
  }
  return { configured: true };
}

function createTransporter() {
  const { host, port, user, pass } = getSmtpConfig();
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
    // Prevent hanging requests with reasonable socket timeouts
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

export type EmailAttachment = {
  filename: string;
  content?: Buffer | string;
  path?: string;
  contentType?: string;
  cid?: string;
};

export async function sendReminderEmail(options: {
  to: string;
  subject: string;
  body: string;
  fromName?: string;
  attachments?: EmailAttachment[];
}): Promise<{ success: boolean; messageId?: string; response?: string; error?: string }> {
  const { to, subject, body, fromName = "SafeVault Boekhouding", attachments = [] } = options;

  if (!to || !to.includes("@")) {
    return { success: false, error: "Ongeldig of ontbrekend e-mailadres van de klant." };
  }

  const configCheck = isEmailConfigured();
  if (!configCheck.configured) {
    console.warn(`[EMAIL DISPATCH NOTICE] ${configCheck.reason}`);
    return {
      success: false,
      error: `E-mailservice niet geconfigureerd: ${configCheck.reason}`,
    };
  }

  const { fromEmail, pass } = getSmtpConfig();

  const safeBody = String(body || "");
  const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  // Process user attachments (separating images from other documents)
  const imageAttachments: Array<{ filename: string; cid: string; att: EmailAttachment }> = [];
  const otherAttachments: EmailAttachment[] = [];

  (attachments || []).forEach((att, idx) => {
    const isImg =
      (att.contentType && att.contentType.startsWith("image/")) ||
      /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(att.filename);
    if (isImg) {
      const cid = att.cid || `img-att-${idx}-${uniqueId}`;
      imageAttachments.push({ filename: att.filename, cid, att });
    } else {
      otherAttachments.push(att);
    }
  });

  // Convert plain body paragraphs to clean HTML paragraphs to ensure full, direct visibility in email clients
  const paragraphs = safeBody.split(/\n\s*\n/);
  const formattedHtml = paragraphs
    .map((p) => {
      const escaped = p
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br/>");
      return `<p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.7; color: #374151;">${escaped}</p>`;
    })
    .join("");

  // Build attached images HTML block
  let imagesHtml = "";
  if (imageAttachments.length > 0) {
    imagesHtml = `
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
        <p style="font-size: 13px; font-weight: 600; color: #374151; margin: 0 0 14px 0;">Bijgevoegde afbeeldingen (${imageAttachments.length}):</p>
        ${imageAttachments
          .map(
            (img) => `
          <div style="margin-bottom: 16px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background: #ffffff;">
            <div style="padding: 12px; text-align: center; background: #f9fafb;">
              <img src="cid:${img.cid}" alt="${img.filename}" style="max-width: 100%; height: auto; border-radius: 6px; display: inline-block;" />
            </div>
            <div style="padding: 8px 12px; font-size: 12px; color: #4b5563; background: #f3f4f6; border-top: 1px solid #e5e7eb;">
              📎 ${img.filename}
            </div>
          </div>`,
          )
          .join("")}
      </div>`;
  }

  // Build other attachments HTML block
  let otherAttsHtml = "";
  if (otherAttachments.length > 0) {
    otherAttsHtml = `
      <div style="margin-top: 20px; padding: 12px 16px; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb;">
        <p style="font-size: 12px; font-weight: 600; color: #374151; margin: 0 0 8px 0;">Bijgevoegde documenten (${otherAttachments.length}):</p>
        <ul style="margin: 0; padding-left: 20px; font-size: 12px; color: #4b5563; line-height: 1.6;">
          ${otherAttachments.map((o) => `<li>${o.filename}</li>`).join("")}
        </ul>
      </div>`;
  }

  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <!-- Anti-trimming preheader to ensure the full email opens directly without 3-dots folding in Gmail/Outlook -->
  <div style="display: none; max-height: 0px; overflow: hidden; mso-hide: all; font-size: 1px; color: #f8fafc; line-height: 1px;">
    ${subject} - SafeVault &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&#8203;[Ref: ${uniqueId}]
  </div>

  <div style="max-width: 600px; margin: 0 auto; padding: 32px 16px; color: #111827;">
    <div style="background-color: #ffffff; border: 1px solid #374151; border-radius: 12px; padding: 36px 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
      <!-- Header with SafeVault Logo -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom: 2px solid #111827; padding-bottom: 20px; margin-bottom: 28px;">
        <tr>
          <td width="48" style="vertical-align: middle;">
            <img src="${SAFEVAULT_LOGO_URL}" alt="SafeVault" width="44" height="44" style="display: block; width: 44px; height: 44px; max-width: 44px; max-height: 44px; border-radius: 10px; object-fit: contain; border: 0; outline: none; -ms-interpolation-mode: bicubic; image-rendering: -webkit-optimize-contrast;" />
          </td>
          <td style="vertical-align: middle; padding-left: 14px;">
            <span style="font-size: 20px; font-weight: 700; color: #111827; letter-spacing: -0.5px; display: block; line-height: 1.2;">SafeVault</span>
            <div style="font-size: 12px; color: #4b5563; font-weight: 500; margin-top: 3px;">Uw beveiligde klantomgeving</div>
          </td>
        </tr>
      </table>

      <!-- Main Content -->
      <div style="font-size: 15px; line-height: 1.7; color: #374151;">
        ${formattedHtml}
      </div>

      ${imagesHtml}
      ${otherAttsHtml}

      <!-- Footer with clear no-reply notice -->
      <div style="margin-top: 36px; padding-top: 24px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; text-align: center;">
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; text-align: center;">
          <p style="margin: 0; font-size: 12px; color: #475569; line-height: 1.5;">
            <strong>Let op (no-reply):</strong> Dit is een automatisch verzonden e-mail vanuit een onbeheerd adres. Reacties op dit bericht worden niet gelezen of beantwoord. Neem voor vragen rechtstreeks contact op met uw boekhouder via uw beveiligde omgeving.
          </p>
        </div>
        <p style="margin: 0 0 4px 0; font-weight: 600; color: #111827;">SafeVault – Uw veilige omgeving voor het aanleveren en verwerken van uw boekhoudgegevens</p>
        <p style="margin: 0; font-size: 10px; color: #9ca3af;">Bericht ID: SV-${uniqueId}</p>
      </div>
    </div>
  </div>
</body>
</html>`;

  const plainText = `${safeBody}\n\n----------------------------------------\nLet op (no-reply): Dit is een automatisch verzonden e-mail vanuit een onbeheerd adres. Reacties op dit bericht worden niet gelezen of beantwoord. Neem voor vragen rechtstreeks contact op met uw boekhouder via uw beveiligde omgeving.`;

  try {
    const transporter = createTransporter();
    console.log(`[EMAIL DISPATCH] Attempting to send email to: ${to} (Subject: ${subject}, Attachments: ${imageAttachments.length + otherAttachments.length})`);

    const finalNodemailerAttachments: any[] = [];
    imageAttachments.forEach((img) => {
      finalNodemailerAttachments.push({
        filename: img.filename,
        content: img.att.content,
        path: img.att.path,
        contentType: img.att.contentType,
        cid: img.cid,
      });
    });
    otherAttachments.forEach((o) => {
      finalNodemailerAttachments.push({
        filename: o.filename,
        content: o.content,
        path: o.path,
        contentType: o.contentType,
      });
    });

    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      text: plainText,
      html: fullHtml,
      replyTo: fromEmail,
      messageId: `<sv-${uniqueId}@safevault.app>`,
      headers: {
        "X-Entity-Ref-ID": uniqueId,
        "X-Auto-Response-Suppress": "OOF, AutoReply",
      },
      attachments: finalNodemailerAttachments,
    });

    console.log(`[EMAIL DISPATCH] Info response:`, JSON.stringify(info, null, 2));

    const hasAccepted = Array.isArray(info.accepted) && info.accepted.length > 0;
    const hasMessageId = Boolean(info.messageId);
    const responseStr = String(info.response || "").toLowerCase();
    const hasOkResponse = responseStr.includes("250") || responseStr.includes("ok") || responseStr.includes("accepted");

    const isSuccessfulDispatch = hasAccepted || hasMessageId || hasOkResponse;

    if (!isSuccessfulDispatch) {
      const rejectedReason = Array.isArray(info.rejected) && info.rejected.length > 0
        ? `Geweigerd door server voor: ${info.rejected.join(", ")}`
        : info.response || "Geen geaccepteerde ontvangers.";
      console.error(`[EMAIL DISPATCH REJECTED] To: ${to} | Reason: ${rejectedReason}`);
      return {
        success: false,
        error: `E-mail geweigerd door e-mailprovider: ${rejectedReason}`,
      };
    }

    console.log(`[EMAIL DISPATCH ACCEPTED] To: ${to} | MessageID: ${info.messageId} | Response: ${info.response}`);
    return {
      success: true,
      messageId: info.messageId,
      response: info.response,
    };
  } catch (err: any) {
    const rawError = err instanceof Error ? err.message : String(err);
    // Sanitize error string to prevent leaks of sensitive info
    const safeError = pass ? rawError.replace(new RegExp(pass, "gi"), "*****") : rawError;
    console.error(`[EMAIL DISPATCH FAILURE] Failed to send email to ${to}:`, safeError);
    return {
      success: false,
      error: `E-mailprovider fout: ${safeError}`,
    };
  }
}

export async function send2FACode(email: string, code: string): Promise<boolean> {
  const configCheck = isEmailConfigured();
  if (!configCheck.configured) {
    console.warn(`[2FA EMAIL NOTICE] Cannot send 2FA email: ${configCheck.reason}`);
    return false;
  }

  const { fromEmail } = getSmtpConfig();
  const textBody = `Uw inlogcode is: ${code}\n\nDeze code is 15 minuten geldig. Deel deze code nooit met anderen.\n\n----------------------------------------\nLet op (no-reply): Dit is een automatisch verzonden e-mail vanuit een onbeheerd adres. Reacties op dit bericht worden niet gelezen of beantwoord.`;

  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Uw SafeVault 2FA Inlogcode</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 32px 16px; color: #111827;">
    <div style="background-color: #ffffff; border: 1px solid #374151; border-radius: 12px; padding: 36px 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
      <!-- Header with SafeVault Logo -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom: 2px solid #111827; padding-bottom: 20px; margin-bottom: 28px;">
        <tr>
          <td width="48" style="vertical-align: middle;">
            <img src="${SAFEVAULT_LOGO_URL}" alt="SafeVault" width="44" height="44" style="display: block; width: 44px; height: 44px; max-width: 44px; max-height: 44px; border-radius: 10px; object-fit: contain; border: 0; outline: none; -ms-interpolation-mode: bicubic; image-rendering: -webkit-optimize-contrast;" />
          </td>
          <td style="vertical-align: middle; padding-left: 14px;">
            <span style="font-size: 20px; font-weight: 700; color: #111827; letter-spacing: -0.5px; display: block; line-height: 1.2;">SafeVault</span>
            <div style="font-size: 12px; color: #4b5563; font-weight: 500; margin-top: 3px;">Beveiligde Inlogauthenticatie</div>
          </td>
        </tr>
      </table>

      <!-- Content -->
      <div style="font-size: 15px; line-height: 1.7; color: #374151;">
        <p style="margin: 0 0 16px 0; font-weight: 600; color: #111827;">Uw inlogcode voor SafeVault</p>
        <p style="margin: 0 0 20px 0;">Gebruik onderstaande eenmalige verificatiecode om in te loggen op uw beveiligde omgeving:</p>
        <div style="background-color: #f9fafb; border: 1px solid #d1d5db; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #111827; font-family: monospace;">${code}</span>
        </div>
        <p style="margin: 0 0 8px 0; font-size: 13px; color: #6b7280;">Deze code is 15 minuten geldig. Deel deze code nooit met anderen, ook niet met medewerkers van SafeVault.</p>
      </div>

      <!-- Footer with clear no-reply notice -->
      <div style="margin-top: 36px; padding-top: 24px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; text-align: center;">
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; text-align: center;">
          <p style="margin: 0; font-size: 12px; color: #475569; line-height: 1.5;">
            <strong>Let op (no-reply):</strong> Dit is een automatisch verzonden e-mail vanuit een onbeheerd adres. Reacties op dit bericht worden niet gelezen of beantwoord.
          </p>
        </div>
        <p style="margin: 0 0 4px 0; font-weight: 600; color: #111827;">SafeVault – Uw veilige omgeving voor het aanleveren en verwerken van uw boekhoudgegevens</p>
      </div>
    </div>
  </div>
</body>
</html>`;

  try {
    const transporter = createTransporter();
    const info = await transporter.sendMail({
      from: `"SafeVault Beveiliging" <${fromEmail}>`,
      to: email,
      subject: "Uw SafeVault 2FA Inlogcode",
      text: textBody,
      html: fullHtml,
      attachments: [],
    });
    const hasAccepted = Array.isArray(info.accepted) && info.accepted.length > 0;
    const hasMessageId = Boolean(info.messageId);
    const responseStr = String(info.response || "").toLowerCase();
    const hasOkResponse = responseStr.includes("250") || responseStr.includes("ok") || responseStr.includes("accepted");
    return hasAccepted || hasMessageId || hasOkResponse;
  } catch (err) {
    console.error("[2FA EMAIL FAILURE] Error sending 2FA email:", err);
    return false;
  }
}

