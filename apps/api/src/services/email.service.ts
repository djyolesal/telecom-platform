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

/** Ce que la messagerie a RÉELLEMENT accepté, destinataire par destinataire. */
export interface ResultatEnvoi {
  ok: boolean;
  acceptes: string[];
  refuses: string[];
  /** Réponse brute du serveur SMTP (« 250 2.0.0 OK 1759... »), pour le journal. */
  reponse?: string;
  messageId?: string;
  erreur?: string;
}

/**
 * Envoie un e-mail et RAPPORTE ce que le serveur a accepté.
 *
 * `sendMail` résout même quand le relais REFUSE tous les destinataires : ils
 * sortent alors dans `rejected` et le message n'est jamais remis. On
 * annonçait « envoyé » à l'écran pendant que personne ne recevait rien. Un
 * envoi sans aucun destinataire accepté est donc un ÉCHEC.
 */
export async function envoyerEmail(opts: MailOptions): Promise<ResultatEnvoi> {
  const tx = getTransporter();
  if (!tx) return { ok: false, acceptes: [], refuses: [], erreur: 'SMTP non configuré' };
  const destinataires = Array.isArray(opts.to) ? opts.to : [opts.to];
  try {
    const info = await tx.sendMail({
      from: env.SMTP_FROM,
      // Les réponses (à noreply@) arrivent sur l'adresse de contact si configurée.
      ...(env.SMTP_REPLY_TO ? { replyTo: env.SMTP_REPLY_TO } : {}),
      to: destinataires.join(','),
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      attachments: opts.attachments,
    }) as { accepted?: unknown[]; rejected?: unknown[]; response?: string; messageId?: string };
    const acceptes = (info.accepted ?? []).map(String);
    const refuses = (info.rejected ?? []).map(String);
    if (!acceptes.length) {
      logger.error(
        `📧 REFUSÉ par la messagerie : "${opts.subject}" → ${destinataires.join(', ')} `
        + `(réponse : ${info.response ?? 'aucune'})`
      );
      return { ok: false, acceptes, refuses, reponse: info.response, erreur: info.response };
    }
    // Le POIDS est journalisé : c'est la première chose qu'on veut savoir quand
    // un message part « accepté » et n'arrive jamais (filtres de pièces
    // jointes, quotas de boîte).
    const poidsKo = Math.round(
      (opts.attachments ?? []).reduce((t, a) => t + (typeof a.content === 'string' ? a.content.length : a.content.length), 0) / 1024
    );
    logger.info(
      `📧 Email accepté : "${opts.subject}" → ${acceptes.join(', ')}`
      + (refuses.length ? ` | REFUSÉS : ${refuses.join(', ')}` : '')
      + (poidsKo ? ` | ${poidsKo} Ko de pièces jointes` : '')
      + ` | ${info.response ?? ''} | id=${info.messageId ?? '-'}`
    );
    return { ok: true, acceptes, refuses, reponse: info.response, messageId: info.messageId };
  } catch (err) {
    logger.error('Échec envoi email:', err);
    return { ok: false, acceptes: [], refuses: destinataires, erreur: (err as Error).message };
  }
}

/** Compatibilité : vrai si au moins un destinataire a été accepté. */
export async function sendEmail(opts: MailOptions): Promise<boolean> {
  return (await envoyerEmail(opts)).ok;
}

export const emailService = { sendEmail };
