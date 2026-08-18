import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

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

export async function sendReminderEmail(options: {
  to: string;
  subject: string;
  body: string;
  fromName?: string;
}): Promise<{ success: boolean; messageId?: string; response?: string; error?: string }> {
  const { to, subject, body, fromName = "SafeVault Boekhouding" } = options;

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

  // Convert plain body to line-broken HTML for email client rendering
  const formattedHtml = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");

  const fullHtml = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff; color: #1e293b;">
    <div style="border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 20px;">
      <h2 style="margin: 0; color: #1e3a8a; font-size: 20px;">SafeVault</h2>
    </div>
    <div style="font-size: 15px; line-height: 1.6; white-space: pre-wrap;">
      ${formattedHtml}
    </div>
    <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
      <p style="margin: 0;">Dit is een automatisch gegeneerd bericht via SafeVault.</p>
    </div>
  </div>`;

  try {
    const transporter = createTransporter();
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      text: body,
      html: fullHtml,
      replyTo: fromEmail,
    });

    const isAccepted = Array.isArray(info.accepted) && info.accepted.length > 0;
    if (!isAccepted) {
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

  try {
    const transporter = createTransporter();
    const info = await transporter.sendMail({
      from: `"SafeVault Beveiliging" <${fromEmail}>`,
      to: email,
      subject: "Uw SafeVault 2FA Code",
      text: `Uw inlogcode is: ${code}\n\nDeze code is 15 minuten geldig. Deel deze code nooit met anderen.`,
      html: `<div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
        <h2>SafeVault Inloggen</h2>
        <p>Uw 2FA inlogcode is:</p>
        <h1 style="letter-spacing: 5px; color: #1e3a8a;">${code}</h1>
        <p style="color: #666; font-size: 12px;">Deze code is 15 minuten geldig. Deel deze code nooit met anderen.</p>
      </div>`,
    });
    return Array.isArray(info.accepted) && info.accepted.length > 0;
  } catch (err) {
    console.error("[2FA EMAIL FAILURE] Error sending 2FA email:", err);
    return false;
  }
}

