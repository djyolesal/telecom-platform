/**
 * IMPORT « région + date de mise en service » depuis un classeur Excel.
 *
 *   npx tsx prisma/scripts/import-sites-update.ts "<fichier.xlsx>"          # simulation
 *   npx tsx prisma/scripts/import-sites-update.ts "<fichier.xlsx>" --appliquer
 *
 * SIMULATION PAR DÉFAUT : un import qui écrit 800 lignes sans qu'on ait pu
 * relire ce qu'il change n'est pas un import, c'est un pari. Sans
 * `--appliquer`, rien n'est écrit et le rapport dit exactement ce qui le
 * serait - y compris les sites du fichier qu'on ne sait pas rattacher.
 *
 * Colonnes attendues (première ligne = en-têtes) :
 *   site | region | Date de mise en service
 */
import path from 'path';
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/**
 * Régions de la plateforme. Le fichier les écrit en capitales et de façon
 * irrégulière (PLATEAUX / Plateaux) : sans cette table, on créerait neuf
 * régions là où il y en a six, et tous les filtres se scinderaient en deux.
 */
const REGIONS: Record<string, string> = {
  'LOME & GOLFE': 'Lomé & Golfe',
  'LOME ET GOLFE': 'Lomé & Golfe',
  MARITIME: 'Maritime',
  PLATEAUX: 'Plateaux',
  CENTRALE: 'Centrale',
  KARA: 'Kara',
  SAVANES: 'Savanes',
};

/** Mois français abrégés tels qu'Excel les écrit en locale fr. */
const MOIS: Record<string, number> = {
  'janv': 1, 'févr': 2, 'fevr': 2, 'mars': 3, 'avr': 4, 'mai': 5, 'juin': 6,
  'juil': 7, 'août': 8, 'aout': 8, 'sept': 9, 'oct': 10, 'nov': 11, 'déc': 12, 'dec': 12,
};

/** Accents et casse écartés : « Aného » et « ANEHO » désignent le même site. */
const cle = (v: string) =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * « 3-oct.-22 » → 2022-10-03. Le pivot des années à deux chiffres est posé à
 * 70 : les sites les plus anciens du parc datent de juin 1999 (lancement du
 * réseau), et sans ce pivot ils seraient enregistrés en 2099.
 */
function dateFr(brut: string): Date | null {
  const m = String(brut).trim().match(/^(\d{1,2})[-/\s]([^\s\-/.]+)\.?[-/\s](\d{2,4})$/);
  if (!m) return null;
  const jour = Number(m[1]);
  const mois = MOIS[m[2].toLowerCase().replace('.', '')];
  if (!mois) return null;
  let an = Number(m[3]);
  if (an < 100) an += an >= 70 ? 1900 : 2000;
  const d = new Date(Date.UTC(an, mois - 1, jour));
  return Number.isNaN(d.getTime()) ? null : d;
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const fichier = process.argv[2];
  const appliquer = process.argv.includes('--appliquer');
  if (!fichier) {
    console.error('Usage : import-sites-update.ts "<fichier.xlsx>" [--appliquer]');
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(fichier));
  const ws = wb.worksheets[0];

  type Ligne = { ligne: number; nom: string; region: string | null; date: Date | null; brutDate: string };
  const lignes: Ligne[] = [];
  const regionsInconnues = new Set<string>();
  const datesIllisibles: string[] = [];

  ws.eachRow((row, i) => {
    if (i === 1) return; // en-têtes
    const nom = String(row.getCell(1).value ?? '').trim();
    if (!nom) return;
    const regionBrute = String(row.getCell(2).value ?? '').trim();
    const brutDate = String(row.getCell(3).value ?? '').trim();

    const region = REGIONS[regionBrute.toUpperCase()] ?? null;
    if (regionBrute && !region) regionsInconnues.add(regionBrute);
    const date = brutDate ? dateFr(brutDate) : null;
    if (brutDate && !date) datesIllisibles.push(`${nom} : « ${brutDate} »`);

    lignes.push({ ligne: i, nom, region, date, brutDate });
  });

  console.log(`Fichier : ${lignes.length} ligne(s) de données.`);
  if (regionsInconnues.size) {
    console.log(`\n⚠ Régions non reconnues (ignorées) : ${[...regionsInconnues].join(', ')}`);
  }
  if (datesIllisibles.length) {
    console.log(`\n⚠ Dates illisibles (ignorées) : ${datesIllisibles.length}`);
    datesIllisibles.slice(0, 5).forEach((d) => console.log(`    ${d}`));
  }

  // Rapprochement sur le NOM normalisé, puis sur le CODE : les deux existent
  // dans les exports d'exploitation, et un fichier mélange souvent les deux.
  const sites = await prisma.site.findMany({
    select: { id: true, code: true, nom: true, region: true, dateMiseEnService: true },
  });
  const parNom = new Map<string, typeof sites>();
  const parCode = new Map<string, (typeof sites)[number]>();
  for (const s of sites) {
    const k = cle(s.nom);
    parNom.set(k, [...(parNom.get(k) ?? []), s]);
    parCode.set(cle(s.code), s);
  }

  const majs: { id: string; nom: string; region?: string; date?: Date; avant: string }[] = [];
  const introuvables: string[] = [];
  const ambigus: string[] = [];
  let inchanges = 0;

  for (const l of lignes) {
    const k = cle(l.nom);
    const candidats = parNom.get(k);
    const site = candidats?.length === 1 ? candidats[0] : parCode.get(k);
    if (!site) {
      if (candidats && candidats.length > 1) ambigus.push(`${l.nom} (${candidats.length} sites portent ce nom)`);
      else introuvables.push(l.nom);
      continue;
    }

    const changeRegion = l.region != null && l.region !== site.region;
    const dateActuelle = site.dateMiseEnService ? fmt(site.dateMiseEnService) : null;
    const changeDate = l.date != null && fmt(l.date) !== dateActuelle;
    if (!changeRegion && !changeDate) { inchanges++; continue; }

    majs.push({
      id: site.id,
      nom: site.nom,
      ...(changeRegion ? { region: l.region! } : {}),
      ...(changeDate ? { date: l.date! } : {}),
      avant: `${site.region}${dateActuelle ? ` · ${dateActuelle}` : ' · (sans date)'}`,
    });
  }

  const changementsRegion = majs.filter((m) => m.region);
  console.log(`\n── Rapprochement ──`);
  console.log(`  sites rapprochés et à mettre à jour : ${majs.length}`);
  console.log(`  déjà conformes                      : ${inchanges}`);
  console.log(`  introuvables dans la plateforme     : ${introuvables.length}`);
  console.log(`  noms ambigus (plusieurs sites)      : ${ambigus.length}`);

  if (introuvables.length) {
    console.log(`\n  Introuvables (les 15 premiers) :`);
    introuvables.slice(0, 15).forEach((n) => console.log(`    ${n}`));
    if (introuvables.length > 15) console.log(`    … et ${introuvables.length - 15} autre(s)`);
  }
  if (ambigus.length) {
    console.log(`\n  Ambigus :`);
    ambigus.forEach((n) => console.log(`    ${n}`));
  }

  // Les changements de RÉGION méritent leur propre décompte : ils déplacent des
  // sites d'un rapport à l'autre, alors qu'une date n'ajoute qu'une information.
  const parBascule = new Map<string, number>();
  for (const m of changementsRegion) {
    const k = `${m.avant.split(' · ')[0]} → ${m.region}`;
    parBascule.set(k, (parBascule.get(k) ?? 0) + 1);
  }
  if (parBascule.size) {
    console.log(`\n── Changements de région (${changementsRegion.length}) ──`);
    [...parBascule.entries()].sort((a, b) => b[1] - a[1])
      .forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));
  }
  console.log(`\n── Dates de mise en service à renseigner : ${majs.filter((m) => m.date).length} ──`);

  if (!appliquer) {
    console.log(`\nSIMULATION - rien n'a été écrit. Relancez avec --appliquer pour enregistrer.`);
    return;
  }

  // Transaction : un import à moitié appliqué laisse un parc dont personne ne
  // sait dans quel état il est.
  await prisma.$transaction(
    majs.map((m) => prisma.site.update({
      where: { id: m.id },
      data: { ...(m.region ? { region: m.region } : {}), ...(m.date ? { dateMiseEnService: m.date } : {}) },
    }))
  );
  console.log(`\n✅ ${majs.length} site(s) mis à jour.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
