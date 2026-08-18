import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { getNum, getRaw, setRaw } from '../services/settings.service';
import { envoyerLotContacts } from '../services/sms.service';

/**
 * Situation périodique par SMS (intervalle paramétrable, 3 h par défaut ;
 * 0 = désactivée) : récapitule ce qui DÉPASSE le seuil (1 h par défaut) —
 * incidents terrain encore ouverts (côté passif) et coupures partielles encore
 * en cours (côté actif). Même aiguillage que les notifications unitaires :
 * chaque contact de prestataire ne reçoit QUE son périmètre (sites de ses lots,
 * selon le scope contractuel), les contacts « toutes sociétés » reçoivent tout.
 * Rien à signaler → aucun SMS. Un contact = un SMS maximum par situation.
 */
export async function situationPeriodiqueJob(): Promise<void> {
  const intervalleH = getNum('notifications.situationIntervalleH', 3);
  if (intervalleH <= 0) return; // désactivée par l'admin

  // Anti-doublon entre passages du cron (toutes les 15 min) : on n'émet que si
  // l'intervalle est écoulé depuis le dernier envoi (marge d'une minute).
  const dernierBrut = getRaw('notifications.situationDernierEnvoi');
  const dernier = dernierBrut ? new Date(String(dernierBrut)).getTime() : 0;
  const maintenant = Date.now();
  if (Number.isFinite(dernier) && maintenant - dernier < intervalleH * 3_600_000 - 60_000) return;

  const seuilH = getNum('notifications.situationSeuilH', 1);
  const limite = new Date(maintenant - seuilH * 3_600_000);
  const heuresDepuis = (d: Date) => Math.max(1, Math.round((maintenant - d.getTime()) / 3_600_000));

  const lotSelect = { select: { assignments: { select: { prestataireId: true, scope: true } } } } as const;
  const [incidents, partielles] = await Promise.all([
    prisma.incident.findMany({
      where: { statut: { in: ['OUVERT', 'EN_COURS'] }, dateOuverture: { lt: limite } },
      select: { dateOuverture: true, site: { select: { nom: true, lot: lotSelect } } },
      orderBy: { dateOuverture: 'asc' },
    }),
    prisma.coupureReseau.findMany({
      where: { dateFin: null, origine: 'LOCALE', technologie: { not: 'SITE' }, incidentId: null, dateDebut: { lt: limite } },
      select: { technologie: true, dateDebut: true, site: { select: { nom: true, lot: lotSelect } } },
      orderBy: { dateDebut: 'asc' },
    }),
  ]);
  if (!incidents.length && !partielles.length) return;

  // Éléments listés « SITE 6h », plafonnés pour tenir dans un SMS.
  const enListe = (items: { nom: string; h: number }[]) => {
    const tri = [...items].sort((a, b) => b.h - a.h);
    const top = tri.slice(0, 4).map((i) => `${i.nom} ${i.h}h`).join(', ');
    return tri.length > 4 ? `${top}, +${tri.length - 4} autres` : top;
  };
  const prestatairesDe = (lot: { assignments: { prestataireId: string; scope: string }[] } | null, scope: 'PASSIVE' | 'ACTIVE') =>
    (lot?.assignments ?? []).filter((a) => a.scope === scope || a.scope === 'LES_DEUX').map((a) => a.prestataireId);

  // Vue par prestataire (périmètre contractuel) + vue globale (toutes sociétés).
  const incParPresta = new Map<string, { nom: string; h: number }[]>();
  const incGlobal: { nom: string; h: number }[] = [];
  for (const i of incidents) {
    const item = { nom: i.site.nom, h: heuresDepuis(i.dateOuverture) };
    incGlobal.push(item);
    for (const p of prestatairesDe(i.site.lot, 'PASSIVE')) {
      const l = incParPresta.get(p); if (l) l.push(item); else incParPresta.set(p, [item]);
    }
  }
  const coupParPresta = new Map<string, { nom: string; h: number }[]>();
  const coupGlobal: { nom: string; h: number }[] = [];
  for (const c of partielles) {
    const item = { nom: `${c.site.nom} (${c.technologie})`, h: heuresDepuis(c.dateDebut) };
    coupGlobal.push(item);
    for (const p of prestatairesDe(c.site.lot, 'ACTIVE')) {
      const l = coupParPresta.get(p); if (l) l.push(item); else coupParPresta.set(p, [item]);
    }
  }

  const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lome' });
  const composer = (incs: { nom: string; h: number }[], coups: { nom: string; h: number }[]) => {
    const parties: string[] = [];
    if (incs.length) parties.push(`${incs.length} incident(s) >${seuilH}h : ${enListe(incs)}`);
    if (coups.length) parties.push(`${coups.length} coupure(s) partielle(s) : ${enListe(coups)}`);
    return parties.length ? `[E&M OpS] Situation ${heure} - ${parties.join(' · ')}` : null;
  };

  const contacts = await prisma.contact.findMany({ where: { actif: true, notifSituations: true } });
  // Un SMS par contact : les contacts partageant le même message sont regroupés
  // en un seul POST passerelle.
  const parMessage = new Map<string, typeof contacts>();
  for (const c of contacts) {
    const message = c.toutesSocietes
      ? composer(incGlobal, coupGlobal)
      : c.prestataireId
        ? composer(incParPresta.get(c.prestataireId) ?? [], coupParPresta.get(c.prestataireId) ?? [])
        : null; // contact interne sans « toutes sociétés » : pas de périmètre → rien
    if (!message) continue;
    const l = parMessage.get(message); if (l) l.push(c); else parMessage.set(message, [c]);
  }
  // Horodatage AVANT la boucle d'envoi : la passerelle peut prendre plusieurs
  // minutes par lot, et le cron suivant (15 min) repassait alors le garde et
  // réémettait TOUTE la situation — SMS payants en double.
  await setRaw('notifications.situationDernierEnvoi', new Date().toISOString());

  for (const [message, cibles] of parMessage) {
    await envoyerLotContacts(cibles, message, 'SITUATION_PERIODIQUE');
  }
  logger.info(`[situation] ${incidents.length} incident(s), ${partielles.length} coupure(s) partielle(s) → ${[...parMessage.values()].flat().length} contact(s)`);
}
