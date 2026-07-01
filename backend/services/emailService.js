import nodemailer from 'nodemailer';

export function normalizeRecipients(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

export function smtpConfig() {
  const user = firstEnv('SMTP_USER', 'EMAIL_USER');
  const pass = firstEnv('SMTP_PASS', 'EMAIL_PASS');
  const host = firstEnv('SMTP_HOST', 'EMAIL_HOST') || (user ? 'smtp.gmail.com' : '');
  const port = Number(firstEnv('SMTP_PORT', 'EMAIL_PORT') || 587);
  const secureText = firstEnv('SMTP_SECURE', 'EMAIL_SECURE').toLowerCase();
  const secure = secureText === 'true' || port === 465;
  const from = firstEnv('SMTP_FROM', 'EMAIL_FROM') || (user ? `myQPMS <${user}>` : '');
  return { host, port, secure, user, pass, from };
}

export function isSmtpConfigured() {
  const config = smtpConfig();
  return Boolean(config.host && config.user && config.pass && config.from);
}

export function createEmailTransporter() {
  const config = smtpConfig();
  if (!isSmtpConfigured()) {
    const error = new Error('SMTP is not configured.');
    error.statusCode = 503;
    error.code = 'smtp_not_configured';
    throw error;
  }
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    connectionTimeout: 30000,
  });
}

export async function sendEmail({ to, cc, subject, text, html, attachments = [] }) {
  const recipients = normalizeRecipients(to);
  const ccRecipients = normalizeRecipients(cc);
  if (!recipients.length) {
    const error = new Error('At least one recipient is required.');
    error.statusCode = 400;
    error.code = 'missing_recipient';
    throw error;
  }

  const transporter = createEmailTransporter();
  const info = await transporter.sendMail({
    from: smtpConfig().from,
    to: recipients,
    cc: ccRecipients,
    subject,
    text,
    html,
    attachments,
  });
  return {
    ok: true,
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
  };
}
