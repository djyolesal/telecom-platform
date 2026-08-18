import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../utils/logger';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST) {
    logger.warn('SMTP non configuré - les emails ne seront pas envoyés');
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

export interface MailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
}

/** Envoie un email. Renvoie false silencieusement si SMTP n'est pas configuré. */
export async function sendEmail(opts: MailOptions): Promise<boolean> {
  const tx = getTransporter();
  if (!tx) return false;
  try {
    await tx.sendMail({
      from: env.SMTP_FROM,
      // Les réponses (à noreply@) arrivent sur l'adresse de contact si configurée.
      ...(env.SMTP_REPLY_TO ? { replyTo: env.SMTP_REPLY_TO } : {}),
      to: Array.isArray(opts.to) ? opts.to.join(',') : opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      attachments: opts.attachments,
    });
    logger.info(`📧 Email envoyé : "${opts.subject}" → ${opts.to}`);
    return true;
  } catch (err) {
    logger.error('Échec envoi email:', err);
    return false;
  }
}

export const emailService = { sendEmail };
