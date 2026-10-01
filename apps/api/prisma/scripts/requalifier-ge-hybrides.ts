/**
 * REQUALIFICATION des entretiens GE des sites HYBRIDES : « GE de production »
 * → « GE de secours ».
 *
 *   npx tsx prisma/scripts/requalifier-ge-hybrides.ts                      # simulation, mois de septembre 2026
 *   npx tsx prisma/scripts/requalifier-ge-hybrides.ts --mois 2026-09       # un autre mois
 *   npx tsx prisma/scripts/requalifier-ge-hybrides.ts --ouverts            # + tous les tickets encore ouverts, toutes dates
 *   npx tsx prisma/scripts/requalifier-ge-hybrides.ts --mois 2026-09 --appliquer
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

/** « 2026-09 » → bornes [1er septembre, 1er octobre[. */
function bornesDuMois(arg: string): { debut: Date; fin: Date; label: string } {
  const m = arg.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) {
    console.error(`Mois invalide : « ${arg} ». Attendu AAAA-MM (ex. 2026-09).`);
    process.exit(1);
  }
  const an = Number(m[1]);
  const mois = Number(m[2]);
  if (!(mois >= 1 && mois <= 12)) {
    console.error(`Mois invalide : « ${arg} ».`);
    process.exit(1);
  }
  // Dates LOCALES, comme la fiche de validation qui borne ses mois sur l'heure
  // du serveur : un mois borné en UTC décalerait les interventions des
  // premières et dernières heures du mois.
  return { debut: new Date(an, mois - 1, 1), fin: new Date(an, mois, 1), label: arg };
}

const fmt = (d: Date | null) =>
  d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';

async function main() {
  const args = process.argv.slice(2);
  const appliquer = args.includes('--appliquer');
  const aussiOuverts = args.includes('--ouverts');
  const iMois = args.indexOf('--mois');
  const { debut, fin, label } = bornesDuMois(iMois >= 0 ? args[iMois + 1] ?? '' : '2026-09');

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
      OR: [
        { dateFin: { gte: debut, lt: fin } },
        { dateFin: null, datePlanifiee: { gte: debut, lt: fin } },
      ],
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

  // Un site qui porte DÉJÀ un entretien « GE de secours » le même mois se
  // retrouvera avec deux interventions sur la même ligne. La fiche compte des
  // sites distincts, elle ne double donc pas - mais l'exploitant doit le voir.
  const sitesDuMois = new Set(duMois.map((m) => m.siteId));
  const dejaSecours = await prisma.maintenance.findMany({
    where: {
      siteId: { in: [...sitesDuMois] },
      tachePreventiveKey: NOUVELLE,
      OR: [
        { dateFin: { gte: debut, lt: fin } },
        { dateFin: null, datePlanifiee: { gte: debut, lt: fin } },
      ],
    },
    select: { siteId: true },
  });
  const doublons = new Set(dejaSecours.map((m) => m.siteId));
  if (doublons.size) {
    console.log(`\n⚠ ${doublons.size} site(s) portent déjà un entretien « GE de secours » sur ${label} :`);
    [...doublons].slice(0, 10).forEach((id) => console.log(`    ${parSite.get(id)?.nom ?? id}`));
    console.log(`  La fiche compte des sites distincts : elle ne comptera pas deux fois.`);
  }

  if (!appliquer) {
    console.log(`\nSIMULATION - rien n'a été écrit. Relancez avec --appliquer pour enregistrer.`);
    return;
  }

  const libelle = (TASK_BY_KEY[NOUVELLE]?.libelle ?? 'Entretien et vidange GE (secours, connecté CEET)').slice(0, 100);
  const { count } = await prisma.maintenance.updateMany({
    where: { id: { in: cibles.map((m) => m.id) } },
    data: { tachePreventiveKey: NOUVELLE, equipement: libelle },
  });
  console.log(`\n✅ ${count} intervention(s) requalifiée(s) en « ${libelle} ».`);
  console.log(`   Régénérez la fiche de validation de ${label} pour les prestataires concernés.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
