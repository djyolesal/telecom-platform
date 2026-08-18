import { subMonths } from 'date-fns';
import { prisma } from '../config/database';
import { buildMonthlyData } from '../controllers/rapports.controller';
import { generateMonthlyReportPdf } from '../services/pdf.service';
import { sendEmail } from '../services/email.service';
import { logger } from '../utils/logger';

/**
 * Génère le rapport du mois précédent et l'envoie par email aux MANAGER,
 * ADMIN et DIRECTION actifs. Exécuté le 1er de chaque mois.
 */
export async function monthlyReportJob(): Promise<void> {
  const lastMonth = subMonths(new Date(), 1);
  const annee = lastMonth.getFullYear();
  const mois = lastMonth.getMonth() + 1;

  const destinataires = await prisma.user.findMany({
    where: { isActive: true, role: { in: ['MANAGER', 'ADMIN', 'DIRECTION'] } },
    select: { email: true },
  });

  if (!destinataires.length) {
    logger.warn('[monthly-report] Aucun destinataire');
    return;
  }

  const data = await buildMonthlyData(annee, mois);
  const pdf = await generateMonthlyReportPdf(data);

  const sent = await sendEmail({
    to: destinataires.map((d) => d.email),
    subject: `Rapport mensuel automatique - ${String(mois).padStart(2, '0')}/${annee}`,
    html: `<p>Bonjour,</p><p>Veuillez trouver ci-joint le rapport mensuel d'exploitation de ${String(mois).padStart(2, '0')}/${annee}.</p><p>— E&M OpS</p>`,
    attachments: [{ filename: `rapport-${annee}-${String(mois).padStart(2, '0')}.pdf`, content: pdf, contentType: 'application/pdf' }],
  });

  logger.info(`[monthly-report] Rapport ${mois}/${annee} ${sent ? 'envoyé' : 'NON envoyé (SMTP off)'} à ${destinataires.length} destinataires`);
}
