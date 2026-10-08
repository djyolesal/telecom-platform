/**
 * DIAGNOSTIC DES PHOTOS TERRAIN - LECTURE SEULE.
 *
 * Mesure la taille RÉELLE (en pixels) des photos stockées, par type
 * (dépotage, maintenance, incident) et par technicien / téléphone, pour
 * répondre à « pourquoi cette photo est-elle minuscule ? » avec des chiffres.
 *
 * Piste connue : sur certains Android d'entrée de gamme, l'appareil photo
 * ignore le fichier demandé par l'application et ne rend que sa MINIATURE
 * (~200 × 150 px). Le code ne réduit rien en dessous de 1600-2000 px : une
 * photo de moins de 800 px vient donc du téléphone, pas de la plateforme.
 *
 * Rien n'est écrit : ni en base, ni dans le stockage. Seuls les premiers
 * octets de chaque photo sont lus (l'en-tête JPEG porte les dimensions).
 *
 * Autonome (aucun import de src/) : l'image de production ne contient que
 * dist/. Lancement en production :
 *
 *   docker compose exec api npx -y tsx prisma/scripts/diagnostic-photos.ts --jours 60
 *
 * Options : --jours N (défaut 60), --max N photos lues par type (défaut 400),
 * --entite <id> : seulement les photos d'UNE intervention (l'identifiant est
 * dans l'adresse de sa fiche, ex. /carburant/<id>), toutes dates confondues,
 * avec la taille de chacune.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client as MinioClient } from 'minio';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const minio = new MinioClient({
  endPoint: process.env.MINIO_ENDPOINT ?? 'minio',
  port: Number(process.env.MINIO_PORT ?? 9000),
  useSSL: ['true', '1'].includes(String(process.env.MINIO_USE_SSL ?? '').toLowerCase()),
  accessKey: process.env.MINIO_ACCESS_KEY ?? '',
  secretKey: process.env.MINIO_SECRET_KEY ?? '',
});
const BUCKET = process.env.MINIO_BUCKET ?? 'telecom-files'; // même défaut que src/config/env.ts

/** Seuil sous lequel une photo est « petite » : rien dans le code n'en produit. */
const PETITE_PX = 800;

function option(nom: string, defaut: number): number {
  const i = process.argv.indexOf(`--${nom}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : defaut;
}

/**
 * Dimensions d'un JPEG lues dans son en-tête : on saute les segments par leur
 * longueur (l'EXIF embarque sa propre miniature, avec ses propres marqueurs :
 * un balayage naïf la prendrait pour l'image) jusqu'au premier SOF.
 */
export function dimensionsJpeg(b: Buffer): { largeur: number; hauteur: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marqueur = b[i + 1];
    if (marqueur === 0xd8 || marqueur === 0x01 || (marqueur >= 0xd0 && marqueur <= 0xd7)) { i += 2; continue; }
    const longueur = b.readUInt16BE(i + 2);
    const estSof = marqueur >= 0xc0 && marqueur <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marqueur);
    if (estSof) return { hauteur: b.readUInt16BE(i + 5), largeur: b.readUInt16BE(i + 7) };
    i += 2 + longueur;
  }
  return null;
}

async function entete(cle: string): Promise<Buffer> {
  // 256 Ko couvrent l'EXIF et sa miniature (64 Ko au plus) avant le SOF.
  const flux = await minio.getPartialObject(BUCKET, cle, 0, 256 * 1024);
  const morceaux: Buffer[] = [];
  for await (const m of flux) morceaux.push(m as Buffer);
  return Buffer.concat(morceaux);
}

interface Ligne {
  type: string; cle: string; le: Date; technicien: string | null; telephone: string | null; version: string | null;
}

function texteOption(nom: string): string | null {
  const i = process.argv.indexOf(`--${nom}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/** Une intervention précise : chaque photo, sa taille, son poids. */
async function uneEntite(id: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ type: string; cle: string; url: string; le: Date }>>(
    `SELECT entity_type AS type, minio_key AS cle, url, created_at AS le
       FROM photos WHERE entity_id = $1 ORDER BY created_at`, id,
  );
  console.log(`\n${rows.length} photo(s) rattachée(s) à ${id}\n`);
  for (const [n, r] of rows.entries()) {
    if (!r.cle) { console.log(`  ${n + 1}. (pas de clé de stockage, url : ${r.url})`); continue; }
    try {
      const stat = await minio.statObject(BUCKET, r.cle);
      const d = dimensionsJpeg(await entete(r.cle));
      console.log(`  ${n + 1}. ${d ? `${d.largeur}×${d.hauteur} px` : 'dimensions illisibles'} · ${Math.round(stat.size / 1024)} Ko · ${r.le.toISOString().slice(0, 16).replace('T', ' ')} · ${r.cle}`);
    } catch (e) {
      console.log(`  ${n + 1}. introuvable dans le stockage (${(e as Error).message}) · ${r.cle}`);
    }
  }
  console.log('');
}

async function main() {
  const entite = texteOption('entite');
  if (entite) return uneEntite(entite);
  const jours = option('jours', 60);
  const max = option('max', 400);
  const lignes: Ligne[] = [];
  for (const type of ['depotage', 'maintenance', 'incident']) {
    const rows = await prisma.$queryRawUnsafe<Array<{ cle: string; le: Date; technicien: string | null; telephone: string | null; version: string | null }>>(
      `SELECT p.minio_key AS cle, p.created_at AS le,
              NULLIF(TRIM(COALESCE(u.prenom, '') || ' ' || COALESCE(u.nom, '')), '') AS technicien,
              u.appareil_label AS telephone, u.app_version AS version
         FROM photos p
         LEFT JOIN depotages d   ON p.entity_type = 'depotage'    AND d.id = p.entity_id
         LEFT JOIN maintenances m ON p.entity_type = 'maintenance' AND m.id = p.entity_id
         LEFT JOIN incidents i   ON p.entity_type = 'incident'    AND i.id = p.entity_id
         LEFT JOIN users u ON u.id = COALESCE(d.technicien_id, m.technicien_id, i.technicien_id)
        WHERE p.entity_type = $1 AND p.minio_key <> ''
          AND p.created_at > now() - ($2 || ' days')::interval
        ORDER BY p.created_at DESC
        LIMIT $3`,
      type, String(jours), max,
    );
    lignes.push(...rows.map((r) => ({ ...r, type })));
  }

  const mesurees: Array<Ligne & { largeur: number; hauteur: number }> = [];
  let illisibles = 0;
  for (const l of lignes) {
    try {
      const d = dimensionsJpeg(await entete(l.cle));
      if (d) mesurees.push({ ...l, ...d }); else illisibles++;
    } catch { illisibles++; }
  }

  const grandCote = (m: { largeur: number; hauteur: number }) => Math.max(m.largeur, m.hauteur);
  const mediane = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

  console.log(`\nPhotos des ${jours} derniers jours (au plus ${max} par type) - ${mesurees.length} mesurées, ${illisibles} illisible(s)\n`);
  console.log('PAR TYPE');
  for (const type of ['depotage', 'maintenance', 'incident']) {
    const t = mesurees.filter((m) => m.type === type);
    if (!t.length) { console.log(`  ${type.padEnd(12)} aucune`); continue; }
    const petites = t.filter((m) => grandCote(m) < PETITE_PX).length;
    console.log(`  ${type.padEnd(12)} ${String(t.length).padStart(4)} photo(s) · grand côté médian ${mediane(t.map(grandCote))} px · ${petites} petite(s) (< ${PETITE_PX} px, ${Math.round((petites / t.length) * 100)} %)`);
  }

  console.log('\nPAR TECHNICIEN ET TÉLÉPHONE (tous types confondus, ceux qui ont au moins une petite photo)');
  const parTech = new Map<string, { total: number; petites: number; exemple: string }>();
  for (const m of mesurees) {
    const cle = `${m.technicien ?? '(inconnu)'} · ${m.telephone ?? 'téléphone inconnu'} · ${m.version ?? '?'}`;
    const e = parTech.get(cle) ?? { total: 0, petites: 0, exemple: '' };
    e.total++;
    if (grandCote(m) < PETITE_PX) { e.petites++; e.exemple ||= `${m.largeur}×${m.hauteur}`; }
    parTech.set(cle, e);
  }
  const lignesTech = [...parTech.entries()].filter(([, e]) => e.petites > 0).sort((a, b) => b[1].petites - a[1].petites);
  if (!lignesTech.length) console.log('  aucune petite photo');
  for (const [cle, e] of lignesTech) console.log(`  ${e.petites}/${e.total} petite(s), ex. ${e.exemple} px  -  ${cle}`);

  console.log('\nDIX PLUS PETITES PHOTOS DE DÉPOTAGE');
  const dep = mesurees.filter((m) => m.type === 'depotage').sort((a, b) => grandCote(a) - grandCote(b)).slice(0, 10);
  for (const m of dep) console.log(`  ${m.largeur}×${m.hauteur} px  ${m.le.toISOString().slice(0, 10)}  ${m.technicien ?? '(inconnu)'} · ${m.telephone ?? '?'}`);
  console.log('');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
