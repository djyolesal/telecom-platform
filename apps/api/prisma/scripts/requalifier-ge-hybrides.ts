/**
 * REQUALIFICATION des entretiens GE des sites HYBRIDES : « GE de production »
 * → « GE de secours ».
 *
 *   npx tsx prisma/scripts/requalifier-ge-hybrides.ts                           # simulation, septembre + octobre 2026
 *   npx tsx prisma/scripts/requalifier-ge-hybrides.ts --mois 2026-09            # un seul mois
 *   npx tsx prisma/scripts/requalifier-ge-hybrides.ts --mois 2026-09,2026-10    # plusieurs, en une passe
 *   npx tsx prisma/scripts/requalifier-ge-hybrides.ts --ouverts                 # + tous les tickets encore ouverts, toutes dates
 *   npx tsx prisma/scripts/requalifier-ge-hybrides.ts --mois 2026-09,2026-10 --appliquer
 *
 * Une intervention CLOSE se rattache au mois par sa date de fin, un ticket
 * encore OUVERT par sa date planifiée - exactement comme la fiche les compte
 * (ou les attend). Les tickets d'octobre déjà générés sous l'ancienne règle
 * sont donc requalifiés comme les interventions de septembre, d'où le double
 * mois par défaut.
 *
 * SIMULATION PAR DÉFAUT. Ces interventions sont comptées sur une fiche de
 * validation signée : on regarde ce qui bouge AVANT de l'écrire.
 *
 * Pourquoi : jusqu'au 01/10/2026, un site hybride (solaire + GE, sans réseau
 * public) voyait son groupe classé « en production ». Ce qui sépare les deux
 * lignes du contrat est le RÉGIME du groupe, pas la présence de la CEET : sur
 * un hybride, le solaire produit et le GE ne démarre qu'en relève. Le
 * catalogue a été corrigé ; les interventions DÉJÀ enregistrées, elles,
 * portent encore l'ancienne clé - d'où ce script.
 *
 * Ce qui est modifié : la clé de tâche et le libellé d'équipement recopié
 * dessus. Rien d'autre - ni les photos, ni les relevés, ni les signatures, ni
 * les dates : la même intervention change de ligne, elle ne change pas de
 * nature.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { TASK_BY_KEY } from '../../src/utils/tachesPreventives';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const ANCIENNE = 'ge_production';
const NOUVELLE = 'ge_secours';

interface Periode { debut: Date; fin: Date; label: string }

/** « 2026-09 » → bornes [1er septembre, 1er octobre[. */
function bornesDuMois(arg: string): Periode {
  const m = arg.trim().match(/^(\d{4})-(\d{1,2})$/);
  const mois = m ? Number(m[2]) : 0;
  if (!m || !(mois >= 1 && mois <= 12)) {
    console.error(`Mois invalide : « ${arg} ». Attendu AAAA-MM (ex. 2026-09), séparés par des virgules.`);
    process.exit(1);
  }
  const an = Number(m[1]);
  // Dates LOCALES, comme la fiche de validation qui borne ses mois sur l'heure
  // du serveur : un mois borné en UTC décalerait les interventions des
  // premières et dernières heures du mois.
  return { debut: new Date(an, mois - 1, 1), fin: new Date(an, mois, 1), label: arg.trim() };
}

/** Filtre Prisma « rattaché à l'un de ces mois », par date de fin ou, à défaut, de planification. */
const dansLesPeriodes = (periodes: Periode[]) => ({
  OR: periodes.flatMap((p) => [
    { dateFin: { gte: p.debut, lt: p.fin } },
    { dateFin: null, datePlanifiee: { gte: p.debut, lt: p.fin } },
  ]),
});

const fmt = (d: Date | null) =>
  d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';

async function main() {
  const args = process.argv.slice(2);
  const appliquer = args.includes('--appliquer');
  const aussiOuverts = args.includes('--ouverts');
  const iMois = args.indexOf('--mois');
  const periodes = (iMois >= 0 ? args[iMois + 1] ?? '' : '2026-09,2026-10')
    .split(',').filter(Boolean).map(bornesDuMois);
  if (!periodes.length) { console.error('Aucun mois à traiter.'); process.exit(1); }
  const label = periodes.map((p) => p.label).join(' + ');

  const sites = await prisma.site.findMany({
    where: { powerConfig: 'HYBRIDE_GE' },
    select: { id: true, nom: true, region: true, statutGE: true },
  });
  console.log(`Sites hybrides (solaire + GE, sans réseau public) : ${sites.length}`);
  if (!sites.length) return;
  const parSite = new Map(sites.map((s) => [s.id, s]));

  // Une intervention se rattache au mois par sa date de FIN quand elle est
  // close, par sa date planifiée tant qu'elle ne l'est pas - exactement comme
  // elle se compte (ou s'attend) sur la fiche.
  const duMois = await prisma.maintenance.findMany({
    where: {
      siteId: { in: [...parSite.keys()] },
      tachePreventiveKey: ANCIENNE,
      ...dansLesPeriodes(periodes),
    },
    select: { id: true, siteId: true, statut: true, dateFin: true, datePlanifiee: true, invalideeLe: true },
    orderBy: { datePlanifiee: 'asc' },
  });

  const ouverts = aussiOuverts
    ? await prisma.maintenance.findMany({
        where: {
          siteId: { in: [...parSite.keys()] },
          tachePreventiveKey: ANCIENNE,
          statut: { in: ['PLANIFIEE', 'EN_COURS', 'SUSPENDUE'] },
          id: { notIn: duMois.map((m) => m.id) },
        },
        select: { id: true, siteId: true, statut: true, dateFin: true, datePlanifiee: true, invalideeLe: true },
        orderBy: { datePlanifiee: 'asc' },
      })
    : [];

  const cibles = [...duMois, ...ouverts];
  console.log(`\n── Interventions « GE de production » à requalifier ──`);
  console.log(`  sur ${label} : ${duMois.length}`);
  if (aussiOuverts) console.log(`  tickets ouverts hors période : ${ouverts.length}`);
  if (!cibles.length) {
    console.log('\nRien à requalifier.');
    return;
  }

  const parStatut = new Map<string, number>();
  for (const m of cibles) parStatut.set(m.statut, (parStatut.get(m.statut) ?? 0) + 1);
  console.log(`\n  Par statut :`);
  [...parStatut.entries()].sort((a, b) => b[1] - a[1]).forEach(([s, n]) => console.log(`    ${String(n).padStart(4)}  ${s}`));

  const invalidees = cibles.filter((m) => m.invalideeLe).length;
  if (invalidees) console.log(`  dont ${invalidees} clôture(s) invalidée(s) (ne comptent sur aucune fiche, requalifiées quand même pour rester cohérentes)`);

  console.log(`\n  Les 15 premières :`);
  cibles.slice(0, 15).forEach((m) => {
    const s = parSite.get(m.siteId)!;
    console.log(`    ${s.nom.padEnd(28).slice(0, 28)} ${s.region.padEnd(14).slice(0, 14)} ${m.statut.padEnd(10)} ${fmt(m.dateFin ?? m.datePlanifiee)}`);
  });
  if (cibles.length > 15) console.log(`    … et ${cibles.length - 15} autre(s)`);

  // Un site qui porte DÉJÀ un entretien « GE de secours » sur la même période
  // s'y retrouvera avec deux interventions. La fiche compte des sites
  // distincts, elle ne double donc pas - mais deux TICKETS OUVERTS sur la même
  // tâche enverraient le technicien deux fois, et l'exploitant doit le voir.
  const sitesDuMois = new Set(duMois.map((m) => m.siteId));
  const dejaSecours = await prisma.maintenance.findMany({
    where: {
      siteId: { in: [...sitesDuMois] },
      tachePreventiveKey: NOUVELLE,
      ...dansLesPeriodes(periodes),
    },
    select: { siteId: true },
  });
  const doublons = new Set(dejaSecours.map((m) => m.siteId));
  if (doublons.size) {
    console.log(`\n⚠ ${doublons.size} site(s) portent déjà un entretien « GE de secours » sur ${label} :`);
    [...doublons].slice(0, 10).forEach((id) => console.log(`    ${parSite.get(id)?.nom ?? id}`));
    console.log(`  La fiche compte des sites distincts : elle ne comptera pas deux fois.`);
    console.log(`  Vérifiez en revanche qu'aucun de ces sites ne se retrouve avec DEUX tickets ouverts sur la tâche.`);
  }

  // ── Collision d'unicité : UN SEUL ticket ouvert par (site, tâche) ──
  // Un index unique partiel (migration 0036) interdit deux tickets ouverts sur
  // le même couple. Si le planning a déjà créé le ticket « GE de secours » d'un
  // site dont l'ancien ticket « GE de production » est encore ouvert, requalifier
  // ce dernier violerait l'index - et ferait échouer TOUTE la requalification,
  // y compris les interventions closes qui, elles, ne posent aucun problème.
  // On écarte donc ces tickets-là et on les nomme : c'est un doublon de travail,
  // il se tranche depuis l'écran des interventions, pas par un script.
  const OUVERTS = ['PLANIFIEE', 'EN_COURS', 'SUSPENDUE'];
  const ciblesOuvertes = cibles.filter((m) => OUVERTS.includes(m.statut));
  const dejaOuvertSecours = ciblesOuvertes.length
    ? await prisma.maintenance.findMany({
        where: {
          siteId: { in: ciblesOuvertes.map((m) => m.siteId) },
          tachePreventiveKey: NOUVELLE,
          statut: { in: OUVERTS as never[] },
        },
        select: { siteId: true },
      })
    : [];
  const bloques = new Set(dejaOuvertSecours.map((m) => m.siteId));
  const aRequalifier = cibles.filter((m) => !(OUVERTS.includes(m.statut) && bloques.has(m.siteId)));
  const ecartes = cibles.length - aRequalifier.length;
  if (ecartes) {
    console.log(`\n⚠ ${ecartes} ticket(s) OUVERT(S) écarté(s) : le site porte déjà un ticket « GE de secours » ouvert.`);
    cibles.filter((m) => OUVERTS.includes(m.statut) && bloques.has(m.siteId))
      .forEach((m) => console.log(`    ${parSite.get(m.siteId)?.nom ?? m.siteId} (${m.statut}, ${fmt(m.datePlanifiee)})`));
    console.log(`  Deux tickets ouverts sur la même tâche enverraient le technicien deux fois :`);
    console.log(`  clôturez ou annulez l'un des deux depuis les interventions, puis relancez.`);
  }
  if (!aRequalifier.length) {
    console.log(`\nRien à requalifier une fois les doublons écartés.`);
    return;
  }

  if (!appliquer) {
    console.log(`\nSIMULATION - rien n'a été écrit. ${aRequalifier.length} intervention(s) seraient requalifiée(s).`);
    console.log(`Relancez avec --appliquer pour enregistrer.`);
    return;
  }

  const libelle = (TASK_BY_KEY[NOUVELLE]?.libelle ?? 'Entretien et vidange GE (secours, connecté CEET)').slice(0, 100);
  const { count } = await prisma.maintenance.updateMany({
    where: { id: { in: aRequalifier.map((m) => m.id) } },
    data: { tachePreventiveKey: NOUVELLE, equipement: libelle },
  });
  console.log(`\n✅ ${count} intervention(s) requalifiée(s) en « ${libelle} ».`);
  console.log(`   Régénérez la fiche de validation de ${label} pour les prestataires concernés.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
