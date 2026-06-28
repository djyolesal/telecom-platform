import { computeManquants } from '../services/manquants.service';
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
  const m = await computeManquants({}); // national, année courante
  const lignes = m.lignesEnRetard;
  const camions = m.camionsCritiques;

  if (!lignes.length && !camions.length) {
    logger.info('[manquant-alert] Aucun manquant à signaler');
    return;
  }

  const critsLignes = lignes.filter((l) => l.critique).sort((a, b) => b.manquant - a.manquant);
  const retardLignes = lignes.filter((l) => !l.critique).sort((a, b) => b.manquant - a.manquant);
  const camionsTri = [...camions].sort((a, b) => b.manquant - a.manquant);
  const totalLitres = Math.round(lignes.reduce((s, l) => s + l.manquant, 0));

  const sections: string[] = [];
  if (critsLignes.length) {
    sections.push('🔴 Critiques :\n' + critsLignes.slice(0, 5).map((l) => `${l.siteCode} — ${L(l.manquant)} (BL ${l.numeroBL})`).join('\n'));
  }
  if (camionsTri.length) {
    sections.push('🚛 Camions (chargé non distribué) :\n' + camionsTri.slice(0, 5).map((c) => `${c.numeroBL} ${c.immatriculation} — ${L(c.manquant)}`).join('\n'));
  }
  if (retardLignes.length) {
    sections.push('🟠 En retard :\n' + retardLignes.slice(0, 5).map((l) => `${l.siteCode} — ${L(l.manquant)} (${l.jours} j)`).join('\n'));
  }
  const body = sections.join('\n\n').slice(0, 1500);

  const nbCrit = critsLignes.length + camionsTri.length;
  const title = `🚚 ${lignes.length} manquant(s)${nbCrit ? ` · ${nbCrit} critique(s)` : ''} — ${L(totalLitres)}`;
  const payload = { type: 'MANQUANT_LIVRAISON', title, body, data: { kind: 'manquant_livraison', total: lignes.length, critiques: nbCrit, totalLitres } };

  await notificationService.sendToRole('MANAGER', payload);

  // Escalade : tout manquant critique (site ou camion) remonte aux administrateurs.
  if (nbCrit > 0) {
    await notificationService.sendToRole('ADMIN', {
      ...payload,
      title: `🔴 ${nbCrit} manquant(s) critique(s) carburant — ${L(totalLitres)}`,
    });
  }

  logger.info(`[manquant-alert] ${lignes.length} manquants (${nbCrit} critiques, ${camionsTri.length} camions) signalés`);
}
