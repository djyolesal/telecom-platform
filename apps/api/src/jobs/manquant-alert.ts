import { computeManquants, computePilotageBL } from '../services/manquants.service';
import { prisma } from '../config/database';
import { statutJaugeage, JAUGEAGE_PREAVIS_JOURS } from '../utils/referentielTransport';
import { notificationService } from '../services/notifications.service';
import { logger } from '../utils/logger';

const L = (v: number) => `${v.toLocaleString('fr-FR')} L`;

/**
 * Alerte sur les manquants de livraison, pondérée par la QUANTITÉ :
 *  - manquants ≥ plancher non soldés au-delà du délai → alerte « en retard » ;
 *  - manquants ≥ seuil critique → alerte immédiate (sans attendre le délai) ;
 *  - camions dont l'écart chargé−distribué dépasse le seuil → signal perte/vol.
 * Les criticals (site ou camion) sont en plus escaladés aux administrateurs.
 */
export async function manquantAlertJob(): Promise<void> {
  // `ouvertsSeulement` : un BC clôturé ou annulé ne doit plus réveiller personne.
  const [m, pilotage, camions_jaugeage] = await Promise.all([
    computeManquants({ ouvertsSeulement: true }), // national, année courante
    computePilotageBL(),
    // Certificats de jaugeage : seuls les camions ACTIFS qui roulent encore
    // (un BL dans les 90 derniers jours) méritent une relance — alerter sur un
    // camion sorti du parc serait du bruit.
    prisma.vehicule.findMany({
      where: {
        isActive: true,
        bonsLivraison: { some: { createdAt: { gte: new Date(Date.now() - 90 * 86_400_000) } } },
      },
      select: { libelle: true, certificatJaugeageExpiration: true, prestataire: { select: { nom: true } } },
    }),
  ]);
  const jaugeages = camions_jaugeage
    .map((v) => ({ ...v, statut: statutJaugeage(v.certificatJaugeageExpiration) }))
    .filter((v) => v.statut === 'EXPIRE' || v.statut === 'EXPIRE_BIENTOT');
  const lignes = m.lignesEnRetard;
  const camions = m.camionsCritiques;
  const nbAttente = pilotage.sansPlan.length + pilotage.brouillonsOublies.length;

  if (!lignes.length && !camions.length && !nbAttente && !jaugeages.length) {
    logger.info('[manquant-alert] Aucun manquant à signaler');
    return;
  }

  const critsLignes = lignes.filter((l) => l.critique).sort((a, b) => b.manquant - a.manquant);
  const retardLignes = lignes.filter((l) => !l.critique).sort((a, b) => b.manquant - a.manquant);
  const camionsTri = [...camions].sort((a, b) => b.manquant - a.manquant);
  const totalLitres = Math.round(lignes.reduce((s, l) => s + l.manquant, 0));

  const sections: string[] = [];
  if (critsLignes.length) {
    sections.push('🔴 Critiques :\n' + critsLignes.slice(0, 5).map((l) => `${l.siteNom ?? l.siteCode} - ${L(l.manquant)} (BL ${l.numeroBL})`).join('\n'));
  }
  if (camionsTri.length) {
    sections.push('🚛 Camions (chargé non distribué) :\n' + camionsTri.slice(0, 5).map((c) => `${c.numeroBL} ${c.immatriculation} - ${L(c.manquant)}`).join('\n'));
  }
  if (retardLignes.length) {
    sections.push('🟠 En retard :\n' + retardLignes.slice(0, 5).map((l) => `${l.siteNom ?? l.siteCode} - ${L(l.manquant)} (${l.jours} j)`).join('\n'));
  }
  // Chargements en attente d'un geste du manager : sans ces deux lignes, un BL
  // parti du dépôt sans plan n'apparaissait dans aucune alerte.
  if (pilotage.sansPlan.length) {
    sections.push(`📋 Chargés sans plan (> ${pilotage.seuilJours} j) :\n` +
      pilotage.sansPlan.slice(0, 5).map((b) => `${b.numeroBL} ${b.immatriculation} - ${L(b.volumeChargeLitres)} (${b.jours} j)`).join('\n'));
  }
  // Un volume chargé sur un barème périmé n'est pas opposable : la relance
  // part AVANT l'échéance (fenêtre de 30 j), pas après le litige.
  if (jaugeages.length) {
    sections.push(`📏 Certificats de jaugeage (préavis ${JAUGEAGE_PREAVIS_JOURS} j) :\n` +
      jaugeages.slice(0, 5).map((v) =>
        `${v.libelle}${v.prestataire ? ` (${v.prestataire.nom})` : ''} - ${v.statut === 'EXPIRE' ? 'EXPIRÉ' : 'expire bientôt'}`
      ).join('\n'));
  }
  if (pilotage.brouillonsOublies.length) {
    sections.push(`📝 Brouillons oubliés : ${pilotage.brouillonsOublies.length} - ` +
      pilotage.brouillonsOublies.slice(0, 3).map((b) => `${b.immatriculation} (${b.jours} j)`).join(', '));
  }
  const body = sections.join('\n\n').slice(0, 1500);

  const nbCrit = critsLignes.length + camionsTri.length;
  const title = lignes.length
    ? `🚚 ${lignes.length} manquant(s)${nbCrit ? ` · ${nbCrit} critique(s)` : ''} - ${L(totalLitres)}`
    : nbAttente
      ? `📋 ${nbAttente} chargement(s) en attente de plan`
      : `📏 ${jaugeages.length} certificat(s) de jaugeage à renouveler`;
  const payload = {
    type: 'MANQUANT_LIVRAISON', title, body,
    data: {
      kind: 'manquant_livraison', total: lignes.length, critiques: nbCrit, totalLitres,
      sansPlan: pilotage.sansPlan.length, brouillons: pilotage.brouillonsOublies.length,
      jaugeages: jaugeages.length,
    },
  };

  await notificationService.sendToRole('MANAGER', payload);

  // Escalade : tout manquant critique (site ou camion) remonte aux administrateurs.
  if (nbCrit > 0) {
    await notificationService.sendToRole('ADMIN', {
      ...payload,
      title: `🔴 ${nbCrit} manquant(s) critique(s) carburant - ${L(totalLitres)}`,
    });
  }

  logger.info(`[manquant-alert] ${lignes.length} manquants (${nbCrit} critiques, ${camionsTri.length} camions), ${pilotage.sansPlan.length} sans plan, ${pilotage.brouillonsOublies.length} brouillons, ${jaugeages.length} jaugeages`);
}
