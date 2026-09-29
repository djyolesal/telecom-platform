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
 * Colonnes lues PAR EN-TÊTE (première ligne), dans n'importe quel ordre :
 *   Code | site | region | Date de mise en service
 *
 * Par en-tête et non par position : un classeur dont on réordonne les colonnes
 * importerait sinon la région dans la date sans que rien ne le signale.
 * `Code` est la clé de rapprochement ; `site` sert de repli et d'affichage.
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

  // ── Colonnes repérées par leur en-tête ──
  const entetes = new Map<string, number>();
  ws.getRow(1).eachCell((c, i) => entetes.set(cle(String(c.value ?? '')), i));
  const colonne = (...noms: string[]) => {
    for (const n of noms) { const i = entetes.get(cle(n)); if (i) return i; }
    return 0;
  };
  const colCode = colonne('Code');
  const colNom = colonne('site', 'nom');
  const colRegion = colonne('region', 'région');
  const colDate = colonne('Date de mise en service', 'mise en service');
  if (!colNom && !colCode) {
    console.error('Aucune colonne « Code » ni « site » dans la première ligne : fichier inattendu.');
    process.exit(1);
  }
  console.log(`Colonnes : code=${colCode || '-'} site=${colNom || '-'} region=${colRegion || '-'} date=${colDate || '-'}`);

  type Ligne = { ligne: number; code: string; nom: string; region: string | null; date: Date | null; brutDate: string };
  const lignes: Ligne[] = [];
  const regionsInconnues = new Set<string>();
  const datesIllisibles: string[] = [];

  ws.eachRow((row, i) => {
    if (i === 1) return; // en-têtes
    const code = colCode ? String(row.getCell(colCode).value ?? '').trim() : '';
    const nom = colNom ? String(row.getCell(colNom).value ?? '').trim() : '';
    if (!code && !nom) return;
    const regionBrute = colRegion ? String(row.getCell(colRegion).value ?? '').trim() : '';
    const brutDate = colDate ? String(row.getCell(colDate).value ?? '').trim() : '';

    const region = REGIONS[regionBrute.toUpperCase()] ?? null;
    if (regionBrute && !region) regionsInconnues.add(regionBrute);
    const date = brutDate ? dateFr(brutDate) : null;
    if (brutDate && !date) datesIllisibles.push(`${nom || code} : « ${brutDate} »`);

    lignes.push({ ligne: i, code, nom, region, date, brutDate });
  });

  console.log(`Fichier : ${lignes.length} ligne(s) de données.`);
  if (regionsInconnues.size) {
    console.log(`\n⚠ Régions non reconnues (ignorées) : ${[...regionsInconnues].join(', ')}`);
  }
  if (datesIllisibles.length) {
    console.log(`\n⚠ Dates illisibles (ignorées) : ${datesIllisibles.length}`);
    datesIllisibles.slice(0, 5).forEach((d) => console.log(`    ${d}`));
  }

  // Rapprochement par CODE d'abord : c'est l'identifiant stable du site. Le nom
  // est un repli - il change d'orthographe, prend ou perd un accent, et deux
  // sites peuvent le partager.
  const sites = await prisma.site.findMany({
    select: { id: true, code: true, nom: true, region: true, dateMiseEnService: true },
  });
  const parNom = new Map<string, typeof sites>();
  const parCode = new Map<string, (typeof sites)[number]>();
  // La normalisation retire les tirets : « LOME7-1 » et « LOME71 » tomberaient
  // sur la même clé. Deux codes distincts qui se confondent ne doivent JAMAIS
  // servir à rapprocher - on préfère un site signalé introuvable à un site
  // silencieusement modifié à la place d'un autre.
  const codesAmbigus = new Set<string>();
  for (const s of sites) {
    const kn = cle(s.nom);
    parNom.set(kn, [...(parNom.get(kn) ?? []), s]);
    const kc = cle(s.code);
    if (parCode.has(kc)) codesAmbigus.add(kc);
    parCode.set(kc, s);
  }
  if (codesAmbigus.size) {
    console.log(`\n⚠ ${codesAmbigus.size} code(s) de site se confondent après normalisation : rapprochement par code désactivé pour eux.`);
  }
  const siteParCode = (code: string) => {
    const k = cle(code);
    return codesAmbigus.has(k) ? undefined : parCode.get(k);
  };

  const majs: { id: string; nom: string; region?: string; date?: Date; avant: string }[] = [];
  const introuvables: string[] = [];
  const ambigus: string[] = [];
  let inchanges = 0;
  let parCodeOk = 0;
  let parNomOk = 0;

  for (const l of lignes) {
    const site = (l.code ? siteParCode(l.code) : undefined) ?? (() => {
      const candidats = l.nom ? parNom.get(cle(l.nom)) : undefined;
      return candidats?.length === 1 ? candidats[0] : undefined;
    })();
    const etiquette = [l.code, l.nom].filter(Boolean).join(' · ');
    if (!site) {
      const candidats = l.nom ? parNom.get(cle(l.nom)) : undefined;
      if (candidats && candidats.length > 1) ambigus.push(`${etiquette} (${candidats.length} sites portent ce nom)`);
      else introuvables.push(etiquette);
      continue;
    }
    if (l.code && siteParCode(l.code)) parCodeOk++; else parNomOk++;

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
  console.log(`  par code : ${parCodeOk}   |   par nom (repli) : ${parNomOk}`);
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
