/**
 * IMPORT UNIQUE — historique des relevés terrain (fichier tickets mai-août 2026).
 *
 * Usage :
 *   DATABASE_URL=... npx ts-node --transpile-only scripts/import-releves-historique.ts <fichier.xlsx>            (répétition à blanc)
 *   DATABASE_URL=... npx ts-node --transpile-only scripts/import-releves-historique.ts <fichier.xlsx> --apply    (écriture réelle)
 *
 * Règles (validées sur l'analyse du 07/09/2026) :
 *  - une ligne du fichier → un relevé GE (niveau cuve + index heures) daté de
 *    la FIN d'intervention, + un relevé CEET si l'index CEET est présent ;
 *  - les dépotages du fichier n'entrent PAS dans la table depotages (pas de
 *    photos/signatures historiques) : seul leur niveau après livraison compte ;
 *  - QUARANTAINE (valeur écartée, ligne conservée) : niveau de cuve > 5 000 L
 *    (virgule oubliée probable) ; index GE/CEET en recul PONCTUEL (la série
 *    revient ensuite à son niveau → saisie erronée). Les reculs DURABLES
 *    (échange de GE, compteur neuf) sont importés tels quels : le moteur de
 *    prédiction rejette de lui-même les deltas négatifs ;
 *  - bi-groupes : heureGE → GE n°1 du site, heureGE2 → GE n°2 (si déclarés) ;
 *  - IDEMPOTENT : marqueur dans observations + saut des (site, source, jour)
 *    déjà couverts par un relevé existant (évite le double comptage avec les
 *    saisies plateforme de la même période). Rejouable sans risque.
 *  - Annulation : DELETE FROM releves_energie WHERE observations = <marqueur>.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';

const MARQUEUR = 'Import historique relevés (tickets 05-08/2026)';
// Fautes de frappe identifiées au rapprochement (99 % exact par ailleurs).
const ALIAS: Record<string, string> = {
  DAVIEMONDJI: 'DAVIEMODJI',
  MPOTI: "N'POTI",
  TANTANCHA: 'TANTANTCHA',
  // Confirmé par l'exploitant (07/09) : même site, ordre des mots inversé.
  KOVIEDZEMEKE: 'DJEMEKEKOVIE',
};
const norm = (s: string) => s.trim().toUpperCase().replace(/[\s\-_']/g, '');

// Prisma 7 : l'adaptateur pg est obligatoire (même motif que prisma/seed.ts).
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

interface Ligne {
  site: string; type: string; dateFin: Date;
  indexCEET: number | null; heureGE: number | null; heureGE2: number | null;
  volumeGasoil: number | null; volumeGasoil2: number | null;
}

function num(v: ExcelJS.CellValue): number | null {
  if (v == null || v === 'NULL' || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Index en recul PONCTUEL dans une série (le point suivant revient vers
 *  l'ancien niveau) : la valeur est une erreur de saisie, à écarter. */
function indexesSuspects(points: { i: number; t: number; val: number }[]): Set<number> {
  const out = new Set<number>();
  const pts = [...points].sort((a, b) => a.t - b.t);
  for (let k = 1; k < pts.length; k++) {
    if (pts[k].val < pts[k - 1].val - 1) {
      const suivant = pts[k + 1];
      if (suivant && Math.abs(suivant.val - pts[k - 1].val) < Math.abs(suivant.val - pts[k].val)) {
        out.add(pts[k].i); // erreur ponctuelle : ce point-là est faux
      }
    }
  }
  return out;
}

async function main() {
  const fichier = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!fichier) { console.error('Usage: import-releves-historique.ts <fichier.xlsx> [--apply]'); process.exit(1); }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fichier);
  const ws = wb.worksheets[0];
  const head: string[] = [];
  ws.getRow(1).eachCell((c, i) => { head[i] = String(c.value); });
  const col = (name: string) => head.indexOf(name);

  const lignes: Ligne[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const site = row.getCell(col('siteName')).value;
    const dateFin = row.getCell(col('dateFin')).value;
    if (!site || !(dateFin instanceof Date)) return;
    lignes.push({
      site: String(site), type: String(row.getCell(col('type')).value ?? ''), dateFin,
      indexCEET: num(row.getCell(col('indexCEET')).value),
      heureGE: num(row.getCell(col('heureGE')).value),
      heureGE2: num(row.getCell(col('heureGE2')).value),
      volumeGasoil: num(row.getCell(col('volumeGasoil')).value),
      volumeGasoil2: num(row.getCell(col('volumeGasoil2')).value),
    });
  });
  console.log(`${lignes.length} lignes lues.`);

  // ── Rapprochement sites ──
  const sites = await prisma.site.findMany({
    where: { isActive: true },
    select: { id: true, nom: true, groupes: { where: { isActive: true }, orderBy: { numero: 'asc' }, select: { id: true } } },
  });
  const parNom = new Map(sites.map((s) => [norm(s.nom), s]));
  const resoudre = (nom: string) => parNom.get(norm(ALIAS[norm(nom)] ?? nom)) ?? parNom.get(norm(nom)) ?? null;

  // ── Quarantaine des index ponctuellement faux (série par site) ──
  const geParSite = new Map<string, { i: number; t: number; val: number }[]>();
  const ceetParSite = new Map<string, { i: number; t: number; val: number }[]>();
  lignes.forEach((l, i) => {
    const k = norm(l.site);
    if (l.heureGE != null) { const a = geParSite.get(k) ?? []; a.push({ i, t: l.dateFin.getTime(), val: l.heureGE }); geParSite.set(k, a); }
    if (l.indexCEET != null) { const a = ceetParSite.get(k) ?? []; a.push({ i, t: l.dateFin.getTime(), val: l.indexCEET }); ceetParSite.set(k, a); }
  });
  const geSuspects = new Set<number>(); const ceetSuspects = new Set<number>();
  for (const pts of geParSite.values()) for (const i of indexesSuspects(pts)) geSuspects.add(i);
  for (const pts of ceetParSite.values()) for (const i of indexesSuspects(pts)) ceetSuspects.add(i);

  // ── Jours déjà couverts par un relevé EXISTANT (site, source, jour) ──
  const debut = new Date(Math.min(...lignes.map((l) => l.dateFin.getTime())));
  const existants = await prisma.releveEnergie.findMany({
    // Les relevés d'un import PRÉCÉDENT (même marqueur) sont exclus : sinon un
    // re-lancement voyait tous les jours « couverts », purgait l'ancien import
    // et ne recréait presque rien — perte de données au rejeu.
    where: { dateReleve: { gte: debut }, source: { in: ['GE', 'CEET'] }, NOT: { observations: MARQUEUR } },
    select: { siteId: true, source: true, dateReleve: true, groupeId: true },
  });
  const jourKey = (siteId: string, source: string, d: Date) => `${siteId}|${source}|${d.toISOString().slice(0, 10)}`;
  const couverts = new Set(existants.map((e) => jourKey(e.siteId, e.source, e.dateReleve)));
  // Clé EXACTE de l'index d'unicité prod (migration 0036) : (site, source,
  // groupe, timestamp). Garde toutes les branches — le fichier contient une
  // paire strictement dupliquée (AVEPOZO2 15/06 11:40:34 ×2) qui a fait
  // échouer le premier passage réel, et un relevé plateforme au même instant
  // exact ferait pareil. Sans elle, createMany tombe en P2002 et la
  // transaction annule tout.
  const exactKey = (siteId: string, source: string, groupeId: string | null, d: Date) =>
    `${siteId}|${source}|${groupeId ?? '-'}|${d.toISOString()}`;
  const exacts = new Set(existants.map((e) => exactKey(e.siteId, e.source, e.groupeId, e.dateReleve)));

  // ── Construction ──
  let crees = 0, sautesDoublon = 0, orphelins = 0, volumesEcartes = 0, geEcartes = 0, ceetEcartes = 0;
  const orphelinsNoms = new Map<string, number>();
  const aCreer: Parameters<typeof prisma.releveEnergie.createMany>[0]['data'] & unknown[] = [] as never;

  lignes.forEach((l, i) => {
    const site = resoudre(l.site);
    if (!site) { orphelins++; orphelinsNoms.set(l.site, (orphelinsNoms.get(l.site) ?? 0) + 1); return; }

    let volume = l.volumeGasoil;
    if (volume != null && volume > 5000) { volume = null; volumesEcartes++; }
    let heure = l.heureGE;
    if (heure != null && geSuspects.has(i)) { heure = null; geEcartes++; }
    let ceet = l.indexCEET;
    if (ceet != null && ceetSuspects.has(i)) { ceet = null; ceetEcartes++; }

    // Le jour était-il déjà couvert AVANT cette ligne ? (évalué une fois : la
    // branche principale ajoute la clé jour — le bi-GE de la MÊME ligne doit
    // quand même passer.)
    const geJourCouvert = couverts.has(jourKey(site.id, 'GE', l.dateFin));

    // Relevé GE (niveau et/ou index) — GE n°1 du site s'il existe.
    if (volume != null || heure != null) {
      const cle = exactKey(site.id, 'GE', site.groupes[0]?.id ?? null, l.dateFin);
      if (geJourCouvert || exacts.has(cle)) sautesDoublon++;
      else {
        (aCreer as unknown[]).push({
          siteId: site.id, dateReleve: l.dateFin, source: 'GE',
          volumeGasoilLitres: volume, indexHeuresGE: heure,
          groupeId: site.groupes[0]?.id ?? null,
          observations: MARQUEUR,
        });
        couverts.add(jourKey(site.id, 'GE', l.dateFin));
        exacts.add(cle);
        crees++;
      }
    }
    // Second groupe (bi-GE) : index/niveau du GE n°2 — mêmes gardes.
    if ((l.heureGE2 != null || l.volumeGasoil2 != null) && site.groupes[1]) {
      const cle2 = exactKey(site.id, 'GE', site.groupes[1].id, l.dateFin);
      if (geJourCouvert || exacts.has(cle2)) sautesDoublon++;
      else {
        (aCreer as unknown[]).push({
          siteId: site.id, dateReleve: l.dateFin, source: 'GE',
          volumeGasoilLitres: l.volumeGasoil2 != null && l.volumeGasoil2 <= 5000 ? l.volumeGasoil2 : null,
          indexHeuresGE: l.heureGE2,
          groupeId: site.groupes[1].id,
          observations: MARQUEUR,
        });
        exacts.add(cle2);
        crees++;
      }
    }
    // Relevé CEET.
    if (ceet != null) {
      const cleC = exactKey(site.id, 'CEET', null, l.dateFin);
      if (couverts.has(jourKey(site.id, 'CEET', l.dateFin)) || exacts.has(cleC)) sautesDoublon++;
      else {
        (aCreer as unknown[]).push({ siteId: site.id, dateReleve: l.dateFin, source: 'CEET', indexCompteur: ceet, observations: MARQUEUR });
        couverts.add(jourKey(site.id, 'CEET', l.dateFin));
        exacts.add(cleC);
        crees++;
      }
    }
  });

  console.log(`\nBilan ${apply ? '(ÉCRITURE RÉELLE)' : '(répétition à blanc — rien n\'est écrit)'} :`);
  console.log(`  relevés à créer            : ${crees}`);
  console.log(`  sautés (jour déjà couvert) : ${sautesDoublon}`);
  console.log(`  lignes orphelines          : ${orphelins} ${orphelins ? JSON.stringify([...orphelinsNoms.entries()]) : ''}`);
  console.log(`  valeurs écartées           : ${volumesEcartes} niveau(x) > 5000 L · ${geEcartes} index GE suspects · ${ceetEcartes} index CEET suspects`);

  if (apply) {
    // Idempotence forte : purge de ce que CE marqueur a déjà créé, puis recréation.
    const purge = await prisma.releveEnergie.deleteMany({ where: { observations: MARQUEUR } });
    if (purge.count) console.log(`  (relevés d'un import précédent purgés : ${purge.count})`);
    const res = await prisma.releveEnergie.createMany({ data: aCreer as never });
    console.log(`  ✅ ${res.count} relevés écrits (marqueur : « ${MARQUEUR} »)`);
    console.log(`  Annulation possible : DELETE FROM releves_energie WHERE observations = '${MARQUEUR}';`);
  }
}

main().finally(() => prisma.$disconnect());
