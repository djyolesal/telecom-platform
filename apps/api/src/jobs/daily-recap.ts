import { startOfMonth, startOfDay } from 'date-fns';
import { prisma } from '../config/database';
import { sendEmail } from '../services/email.service';
import { getNum } from '../services/settings.service';
import { logger } from '../utils/logger';

/**
 * RÉCAP JOURNALIER par email — envoyé chaque jour à 23h GMT aux superviseurs
 * et aux équipes internes : les activités du 1er du mois au jour J, chacun
 * pour SON périmètre, sections par CONTRAT (passif/actif vs solaire).
 *
 * - Superviseur rattaché à un prestataire → uniquement les sites des lots de
 *   sa société, et seulement les sections des contrats qu'elle détient.
 * - Internes (superviseurs sans société, MANAGER, ADMIN, DIRECTION) → tout le
 *   parc, toutes les sections.
 * - Un seul calcul par périmètre (le parc + un par société), puis l'email est
 *   adressé à tous les destinataires du même périmètre.
 *
 * Désactivable sans redéploiement : réglage `recap.actif` (0 = coupé).
 */

interface BlocMaintenances {
  terminees: number;
  terminesAujourdhui: number;
  enCours: number;
  planifiees: number;
  enRetard: { site: string; equipement: string; datePlanifiee: Date }[];
}

interface RecapData {
  passif: BlocMaintenances | null; // null = contrat non détenu par ce périmètre
  solaire: BlocMaintenances | null;
  depotages: { nombre: number; litres: number; aujourdhui: number } | null;
  incidents: {
    ouvertsPeriode: number;
    resolus: number;
    encoreOuverts: number;
    ouvertsAujourdhui: number;
    critiquesOuverts: { site: string; reference: string | null; depuis: Date }[];
  };
}

const LABEL_STATUT: Record<string, string> = { PLANIFIEE: 'planifiée', EN_COURS: 'en cours' };

async function blocMaintenances(
  siteIds: string[] | null, // null = tout le parc
  solaire: boolean,
  debutMois: Date,
  debutJour: Date,
): Promise<BlocMaintenances> {
  const cat = solaire ? { categorie: 'SOLAIRE' as const } : { categorie: { not: 'SOLAIRE' as const } };
  const scope = siteIds ? { siteId: { in: siteIds } } : {};
  // Le mois « d'activité » : planifiées dans le mois OU terminées dans le mois
  // (une maintenance planifiée fin juillet mais terminée en août compte).
  const wherePeriode = {
    ...scope, ...cat,
    OR: [{ datePlanifiee: { gte: debutMois } }, { dateFin: { gte: debutMois } }],
    statut: { not: 'ANNULEE' as const },
  };
  const [terminees, terminesAujourdhui, enCours, planifiees, retard] = await Promise.all([
    prisma.maintenance.count({ where: { ...wherePeriode, statut: 'TERMINEE' } }),
    prisma.maintenance.count({ where: { ...scope, ...cat, statut: 'TERMINEE', dateFin: { gte: debutJour } } }),
    prisma.maintenance.count({ where: { ...wherePeriode, statut: { in: ['EN_COURS', 'SUSPENDUE'] } } }),
    prisma.maintenance.count({ where: { ...wherePeriode, statut: 'PLANIFIEE' } }),
    prisma.maintenance.findMany({
      where: { ...scope, ...cat, statut: { in: ['PLANIFIEE', 'EN_COURS', 'SUSPENDUE'] }, datePlanifiee: { lt: debutJour } },
      orderBy: { datePlanifiee: 'asc' },
      take: 5,
      select: { equipement: true, datePlanifiee: true, statut: true, site: { select: { code: true } } },
    }),
  ]);
  return {
    terminees,
    terminesAujourdhui,
    enCours,
    planifiees,
    enRetard: retard.map((m) => ({
      site: m.site?.code ?? '—',
      equipement: `${m.equipement} (${LABEL_STATUT[m.statut] ?? m.statut.toLowerCase()})`,
      datePlanifiee: m.datePlanifiee,
    })),
  };
}

async function calculerRecap(prestataireId: string | null, debutMois: Date, debutJour: Date): Promise<RecapData | null> {
  // Découpage par CONTRAT : sites passifs (lot) et sites solaires (lotSolaire)
  // du périmètre. Interne (null) = tout le parc, les deux contrats.
  let passifIds: string[] | null = null;
  let solaireIds: string[] | null = null;
  let tousIds: string[] | null = null;
  if (prestataireId) {
    const [passifs, solaires] = await Promise.all([
      prisma.site.findMany({
        where: { isActive: true, lot: { assignments: { some: { prestataireId } } } },
        select: { id: true },
      }),
      prisma.site.findMany({
        where: { isActive: true, lotSolaire: { assignments: { some: { prestataireId } } } },
        select: { id: true },
      }),
    ]);
    passifIds = passifs.map((s) => s.id);
    solaireIds = solaires.map((s) => s.id);
    tousIds = [...new Set([...passifIds, ...solaireIds])];
    if (!tousIds.length) return null; // société sans site : pas d'email
  }

  const detientPassif = !prestataireId || (passifIds?.length ?? 0) > 0;
  const detientSolaire = !prestataireId || (solaireIds?.length ?? 0) > 0;

  const [passif, solaire, incidents, depotages] = await Promise.all([
    detientPassif ? blocMaintenances(passifIds, false, debutMois, debutJour) : Promise.resolve(null),
    detientSolaire ? blocMaintenances(solaireIds, true, debutMois, debutJour) : Promise.resolve(null),
    (async () => {
      const scope = tousIds ? { siteId: { in: tousIds } } : {};
      const [ouvertsPeriode, resolus, encoreOuverts, ouvertsAujourdhui, critiques] = await Promise.all([
        prisma.incident.count({ where: { ...scope, dateOuverture: { gte: debutMois } } }),
        prisma.incident.count({ where: { ...scope, dateResolution: { gte: debutMois } } }),
        prisma.incident.count({ where: { ...scope, statut: { in: ['OUVERT', 'EN_COURS'] } } }),
        prisma.incident.count({ where: { ...scope, dateOuverture: { gte: debutJour } } }),
        prisma.incident.findMany({
          where: { ...scope, statut: { in: ['OUVERT', 'EN_COURS'] }, severite: 'CRITIQUE' },
          orderBy: { dateOuverture: 'asc' },
          take: 5,
          select: { reference: true, dateOuverture: true, site: { select: { code: true } } },
        }),
      ]);
      return {
        ouvertsPeriode, resolus, encoreOuverts, ouvertsAujourdhui,
        critiquesOuverts: critiques.map((i) => ({ site: i.site?.code ?? '—', reference: i.reference, depuis: i.dateOuverture })),
      };
    })(),
    (async () => {
      if (!detientPassif) return null; // le carburant est hors périmètre solaire
      const scope = passifIds ? { siteId: { in: passifIds } } : {};
      const [agg, aujourdhui] = await Promise.all([
        prisma.depotage.aggregate({ where: { ...scope, dateDepotage: { gte: debutMois } }, _count: true, _sum: { volumeLitres: true } }),
        prisma.depotage.count({ where: { ...scope, dateDepotage: { gte: debutJour } } }),
      ]);
      return { nombre: agg._count, litres: Math.round(Number(agg._sum.volumeLitres ?? 0)), aujourdhui };
    })(),
  ]);

  return { passif, solaire, depotages, incidents };
}

// ── Rendu HTML (styles inline : clients mail) ────────────────────────────────
const NAVY = '#1B3F6B';
const fmtD = (d: Date) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

function ligne(label: string, valeur: string, accent = false): string {
  return `<tr><td style="padding:6px 12px;color:#555;border-bottom:1px solid #eef1f5;">${label}</td>
    <td style="padding:6px 12px;text-align:right;font-weight:${accent ? '700' : '600'};color:${accent ? NAVY : '#222'};border-bottom:1px solid #eef1f5;">${valeur}</td></tr>`;
}

function sectionMaintenances(titre: string, b: BlocMaintenances): string {
  const total = b.terminees + b.enCours + b.planifiees;
  const pct = total ? Math.round((b.terminees / total) * 100) : 0;
  const retard = b.enRetard.length
    ? `<p style="margin:8px 12px 4px;font-size:12px;color:#B26A00;"><b>En retard :</b> ${b.enRetard
        .map((r) => `${r.site} · ${r.equipement} (prévu ${fmtD(r.datePlanifiee)})`)
        .join(' — ')}</p>`
    : '';
  return `
  <h3 style="margin:18px 0 6px;color:${NAVY};font-size:15px;">${titre}</h3>
  <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3e8ef;border-radius:6px;font-size:13px;">
    ${ligne('Terminées (mois)', `${b.terminees}${b.terminesAujourdhui ? ` <span style="color:#1C6B49;">(+${b.terminesAujourdhui} aujourd'hui)</span>` : ''}`)}
    ${ligne('En cours / suspendues', String(b.enCours))}
    ${ligne('Planifiées restantes', String(b.planifiees))}
    ${ligne('Avancement du mois', `${pct} %`, true)}
  </table>${retard}`;
}

export function rendreEmail(d: RecapData, jour: Date, perimetreLabel: string): string {
  const inc = d.incidents;
  const critiques = inc.critiquesOuverts.length
    ? `<p style="margin:8px 12px 4px;font-size:12px;color:#B23124;"><b>Critiques ouverts :</b> ${inc.critiquesOuverts
        .map((c) => `${c.site}${c.reference ? ` · ${c.reference}` : ''} (depuis ${fmtD(c.depuis)})`)
        .join(' — ')}</p>`
    : '';
  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;color:#222;">
    <div style="background:${NAVY};color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;">
      <p style="margin:0;font-size:17px;font-weight:700;">E&M OpS — Récap journalier</p>
      <p style="margin:4px 0 0;font-size:13px;color:#cdd9e8;">${perimetreLabel} · du 1er du mois au ${jour.toLocaleDateString('fr-FR')}</p>
    </div>
    <div style="background:#f7f9fc;border:1px solid #e3e8ef;border-top:0;padding:12px 16px 18px;border-radius:0 0 8px 8px;">
      ${d.passif ? sectionMaintenances('Maintenance passive / active', d.passif) : ''}
      ${d.solaire ? sectionMaintenances('Maintenance solaire', d.solaire) : ''}
      <h3 style="margin:18px 0 6px;color:${NAVY};font-size:15px;">Incidents</h3>
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3e8ef;border-radius:6px;font-size:13px;">
        ${ligne('Ouverts sur le mois', `${inc.ouvertsPeriode}${inc.ouvertsAujourdhui ? ` <span style="color:#B26A00;">(+${inc.ouvertsAujourdhui} aujourd'hui)</span>` : ''}`)}
        ${ligne('Résolus sur le mois', String(inc.resolus))}
        ${ligne('Encore ouverts', String(inc.encoreOuverts), true)}
      </table>${critiques}
      ${d.depotages ? `
      <h3 style="margin:18px 0 6px;color:${NAVY};font-size:15px;">Carburant</h3>
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3e8ef;border-radius:6px;font-size:13px;">
        ${ligne('Dépotages (mois)', `${d.depotages.nombre}${d.depotages.aujourdhui ? ` <span style="color:#1C6B49;">(+${d.depotages.aujourdhui} aujourd'hui)</span>` : ''}`)}
        ${ligne('Volume livré', `${d.depotages.litres.toLocaleString('fr-FR')} L`, true)}
      </table>` : ''}
      <p style="margin:16px 0 0;font-size:11px;color:#8a94a0;">Récap automatique quotidien (23h GMT) — détail dans l'application. Réglage « recap.actif » pour le désactiver.</p>
    </div>
  </div>`;
}

export async function dailyRecapJob(): Promise<void> {
  if (getNum('recap.actif', 1) !== 1) {
    logger.info('[daily-recap] désactivé (recap.actif=0)');
    return;
  }
  const maintenant = new Date();
  const debutMois = startOfMonth(maintenant);
  const debutJour = startOfDay(maintenant);

  // Destinataires : superviseurs (chacun son périmètre) + internes (tout le parc).
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { in: ['SUPERVISEUR', 'MANAGER', 'ADMIN', 'DIRECTION'] }, email: { not: '' } },
    select: { email: true, prestataireId: true, role: true },
  });
  if (!users.length) { logger.warn('[daily-recap] aucun destinataire'); return; }

  // Groupes de périmètre : un calcul par prestataire + un pour le parc entier.
  const groupes = new Map<string, string[]>(); // clé = prestataireId | 'INTERNE'
  for (const u of users) {
    const cle = u.role === 'SUPERVISEUR' && u.prestataireId ? u.prestataireId : 'INTERNE';
    groupes.set(cle, [...(groupes.get(cle) ?? []), u.email]);
  }

  const sujets = `Récap E&M OpS du ${maintenant.toLocaleDateString('fr-FR')}`;
  let envoyes = 0;
  for (const [cle, emails] of groupes) {
    const prestataireId = cle === 'INTERNE' ? null : cle;
    const data = await calculerRecap(prestataireId, debutMois, debutJour);
    if (!data) continue; // société sans site
    const label = prestataireId
      ? (await prisma.prestataire.findUnique({ where: { id: prestataireId }, select: { nom: true } }))?.nom ?? 'Votre périmètre'
      : 'Parc entier';
    const ok = await sendEmail({ to: emails, subject: sujets, html: rendreEmail(data, maintenant, label) });
    if (ok) envoyes += emails.length;
  }
  logger.info(`[daily-recap] ${envoyes}/${users.length} destinataire(s) servis (${groupes.size} périmètre(s))`);
}
