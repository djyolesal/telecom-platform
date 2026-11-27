import { prisma } from '../config/database';
import { minioClient, MINIO_BUCKET } from '../config/minio';
import { CHAMPS_FICHIERS, PARAMETRES_FICHIERS, cleDe } from '../jobs/purge-orphelins';

/**
 * FICHIERS RÉFÉRENCÉS EN BASE MAIS ABSENTS DE MINIO. LECTURE SEULE.
 *
 *   node dist/scripts/fichiersManquants.js          > manquants.csv
 *   node dist/scripts/fichiersManquants.js --cles   > cles.txt
 *
 * CSV (« ; ») : table, colonne, id, repère lisible, clé. Avec --cles : une clé
 * par ligne, pour la restauration depuis les sauvegardes
 * (infra/scripts/restaurer-fichiers.sh). Résumé par colonne sur stderr.
 */
const REPERE: Record<string, string> = {
  vehicule: 'immatriculation',
  bonLivraison: 'numeroBL',
  bonCommande: 'numero',
  mouvementCarburant: 'reference',
};

type Delegue = { findMany(args: unknown): Promise<Array<Record<string, unknown>>> };

async function existe(cle: string): Promise<boolean> {
  try { await minioClient.statObject(MINIO_BUCKET, cle); return true; } catch { return false; }
}

async function main() {
  const seulementCles = process.argv.includes('--cles');
  const refs: Array<{ table: string; colonne: string; id: string; repere: string; cle: string }> = [];

  for (const [modele, champs] of Object.entries(CHAMPS_FICHIERS)) {
    const repere = REPERE[modele];
    const select: Record<string, true> = { id: true, ...Object.fromEntries(champs.map((c) => [c, true as const])) };
    if (repere) select[repere] = true;
    const lignes = await (prisma as unknown as Record<string, Delegue>)[modele].findMany({ select });
    for (const l of lignes) {
      const vues = new Set<string>();
      for (const c of champs) {
        const cle = typeof l[c] === 'string' ? cleDe(l[c] as string) : null;
        if (!cle || vues.has(cle)) continue; // photo : minioKey et url désignent le même objet
        vues.add(cle);
        refs.push({ table: modele, colonne: c, id: String(l.id), repere: repere ? String(l[repere] ?? '') : '', cle });
      }
    }
  }
  const parametres = await prisma.systemSettings.findMany({ where: { key: { in: PARAMETRES_FICHIERS } } });
  for (const p of parametres) {
    const cle = typeof p.value === 'string' ? cleDe(p.value) : null;
    if (cle) refs.push({ table: 'systemSettings', colonne: 'value', id: p.key, repere: p.key, cle });
  }

  // Vérification objet par objet (statObject), 20 à la fois.
  const manquants: typeof refs = [];
  for (let i = 0; i < refs.length; i += 20) {
    const lot = refs.slice(i, i + 20);
    const ok = await Promise.all(lot.map((r) => existe(r.cle)));
    lot.forEach((r, j) => { if (!ok[j]) manquants.push(r); });
  }

  if (seulementCles) {
    for (const k of new Set(manquants.map((m) => m.cle))) process.stdout.write(`${k}\n`);
  } else {
    process.stdout.write('table;colonne;id;repere;cle\n');
    for (const m of manquants) process.stdout.write(`${m.table};${m.colonne};${m.id};${m.repere};${m.cle}\n`);
  }

  const resume = new Map<string, { total: number; manquants: number }>();
  for (const r of refs) {
    const k = `${r.table}.${r.colonne}`;
    const e = resume.get(k) ?? { total: 0, manquants: 0 };
    e.total++;
    resume.set(k, e);
  }
  for (const m of manquants) resume.get(`${m.table}.${m.colonne}`)!.manquants++;
  process.stderr.write(`\n${manquants.length} fichier(s) manquant(s) sur ${refs.length} référencé(s)\n`);
  for (const [k, e] of [...resume].sort()) {
    if (e.manquants) process.stderr.write(`  ${k} : ${e.manquants} manquant(s) / ${e.total}\n`);
  }
}

main()
  .catch((e) => { process.stderr.write(`${e instanceof Error ? e.message : e}\n`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
