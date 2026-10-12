import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';

/**
 * Rapprochement des pièces de rechange saisies librement sur le terrain vers
 * le catalogue `pieces_ref`. Compatibilité APK : le mobile envoie
 * {nom, reference, quantite, coutUnitaire} en texte libre depuis toujours -
 * le serveur normalise et fait le lien quand il est SANS ambiguïté, sinon la
 * ligne reste libre (rattachable a posteriori en admin). Jamais de blocage.
 */

export interface PieceSaisie {
  nom?: unknown;
  reference?: unknown;
  quantite?: unknown;
  coutUnitaire?: unknown;
  pieceRefId?: unknown; // un client récent peut cibler directement le catalogue
}

export interface PieceRapprochee {
  nom: string;
  reference: string | null;
  quantite: number;
  coutUnitaire: number | null;
  pieceRefId: string | null;
}

/** Normalisation de rapprochement : casse, accents, et TOUT séparateur
 *  supprimé - « Batterie 12 V 100 Ah » et « batterie 12v100ah » sont la même
 *  pièce (replier les espaces ne suffit pas : « 100ah » ≠ « 100 ah »). */
export const normaliserPiece = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');

async function indexCatalogue(): Promise<{ idx: Map<string, string>; idsActifs: Set<string> }> {
  const refs = await prisma.pieceRef.findMany({ where: { actif: true }, select: { id: true, code: true, libelle: true, synonymes: true } });
  const idx = new Map<string, string>();
  // Une clé normalisée revendiquée par DEUX références est ambiguë : on la
  // retire (un rapprochement douteux ne s'invente pas - même règle que l'OSS).
  const doublons = new Set<string>();
  const poser = (cle: string, id: string) => {
    if (!cle) return;
    if (idx.has(cle) && idx.get(cle) !== id) { doublons.add(cle); return; }
    idx.set(cle, id);
  };
  for (const r of refs) {
    poser(normaliserPiece(r.code), r.id);
    poser(normaliserPiece(r.libelle), r.id);
    for (const syn of r.synonymes ?? []) poser(normaliserPiece(syn), r.id);
  }
  for (const cle of doublons) idx.delete(cle);
  return { idx, idsActifs: new Set(refs.map((r) => r.id)) };
}

/** Assainit et rapproche une liste de pièces saisies (création/clôture). */
export async function rapprocherPieces(brutes: PieceSaisie[]): Promise<PieceRapprochee[]> {
  const lignes = brutes
    .map((p) => ({
      nom: String(p.nom ?? '').trim().slice(0, 100),
      reference: p.reference != null && String(p.reference).trim() ? String(p.reference).trim().slice(0, 50) : null,
      quantite: Math.max(1, Math.round(Number(p.quantite) || 1)),
      coutUnitaire: p.coutUnitaire != null && Number.isFinite(Number(p.coutUnitaire)) ? Number(p.coutUnitaire) : null,
      pieceRefIdClient: typeof p.pieceRefId === 'string' ? p.pieceRefId : null,
    }))
    .filter((p) => p.nom);
  if (!lignes.length) return [];

  const { idx, idsActifs } = await indexCatalogue();
  return lignes.map((p) => ({
    nom: p.nom,
    reference: p.reference,
    quantite: p.quantite,
    coutUnitaire: p.coutUnitaire,
    // Un pieceRefId explicite prime s'il désigne une référence ACTIVE - même
    // une référence dont les clés textuelles sont ambiguës reste ciblable.
    pieceRefId: (p.pieceRefIdClient && idsActifs.has(p.pieceRefIdClient) ? p.pieceRefIdClient : null)
      ?? idx.get(normaliserPiece(p.nom))
      ?? (p.reference ? idx.get(normaliserPiece(p.reference)) : undefined)
      ?? null,
  }));
}

/**
 * Rapprochement A POSTERIORI de l'historique : relie les lignes encore libres
 * dont le nom ou la référence correspond désormais à une entrée du catalogue
 * (à relancer après chaque enrichissement du référentiel).
 */
export async function rapprocherHistorique(): Promise<{ examinees: number; rapprochees: number }> {
  const { idx } = await indexCatalogue();
  const libres = await prisma.pieceRechange.findMany({
    where: { pieceRefId: null },
    select: { id: true, nom: true, reference: true },
  });
  // Groupé par référence cible : quelques updateMany au lieu d'un UPDATE par ligne.
  const parRef = new Map<string, string[]>();
  for (const p of libres) {
    const refId = idx.get(normaliserPiece(p.nom)) ?? (p.reference ? idx.get(normaliserPiece(p.reference)) : undefined);
    if (!refId) continue;
    (parRef.get(refId) ?? parRef.set(refId, []).get(refId)!).push(p.id);
  }
  let rapprochees = 0;
  for (const [refId, ids] of parRef) {
    await prisma.pieceRechange.updateMany({ where: { id: { in: ids } }, data: { pieceRefId: refId } });
    rapprochees += ids.length;
  }
  return { examinees: libres.length, rapprochees };
}

/**
 * Synonymes saisis pour une pièce (liste, ou texte séparé par virgules ou
 * retours à la ligne), nettoyés. Refuse un synonyme qui désigne déjà une AUTRE
 * pièce active (code, libellé ou synonyme) : il rendrait les deux ambiguës, et
 * l'index les retirerait en silence - mieux vaut le dire à la saisie.
 */
export async function validerSynonymes(
  brut: unknown,
  piece: { id?: string; code: string; libelle: string },
): Promise<string[]> {
  const liste = Array.isArray(brut) ? brut.map(String) : String(brut ?? '').split(/[,\n;]/);
  const propres = new Set([normaliserPiece(piece.code), normaliserPiece(piece.libelle)]);
  const vus = new Set<string>();
  const out: string[] = [];
  for (const s of liste.map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean)) {
    const cle = normaliserPiece(s);
    if (!cle || propres.has(cle) || vus.has(cle)) continue;
    if (s.length > 120) throw new AppError(`Synonyme trop long (120 caractères au plus) : « ${s.slice(0, 40)}… »`, 422);
    vus.add(cle);
    out.push(s);
  }
  if (out.length > 20) throw new AppError('20 synonymes au plus par pièce.', 422);
  if (!out.length) return [];

  const autres = await prisma.pieceRef.findMany({
    // La pièce elle-même est exclue par id ET par code (création = upsert sur le code).
    where: { actif: true, NOT: [{ code: piece.code }, ...(piece.id ? [{ id: piece.id }] : [])] },
    select: { libelle: true, code: true, synonymes: true },
  });
  for (const a of autres) {
    const cles = new Set([normaliserPiece(a.code), normaliserPiece(a.libelle), ...(a.synonymes ?? []).map(normaliserPiece)]);
    const conflit = out.find((s) => cles.has(normaliserPiece(s)));
    if (conflit) throw new AppError(`« ${conflit} » désigne déjà la pièce « ${a.libelle} ».`, 409);
  }
  return out;
}

/** Mots significatifs d'un libellé (accents, casse et mots vides retirés). */
const VIDES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'a', 'au', 'aux', 'et', 'en', 'pour', 'l', 'd', 'un', 'une']);
export const motsPiece = (s: string): string[] =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter((m) => m && !VIDES.has(m));

/**
 * Pièce du catalogue la plus proche d'un texte libre : mots communs (avec le
 * libellé et les synonymes), pondérés par la part du texte couverte. Une
 * SUGGESTION seulement - l'admin confirme, rien n'est rattaché sans lui.
 */
export function suggestionPiece(
  texte: string,
  catalogue: Array<{ id: string; libelle: string; synonymes?: string[] | null }>,
): { id: string; libelle: string } | null {
  const mots = new Set(motsPiece(texte));
  if (!mots.size) return null;
  let meilleur: { id: string; libelle: string; score: number } | null = null;
  for (const p of catalogue) {
    for (const nom of [p.libelle, ...(p.synonymes ?? [])]) {
      const cand = motsPiece(nom);
      if (!cand.length) continue;
      const communs = cand.filter((m) => mots.has(m) || [...mots].some((x) => x.length >= 4 && (m.startsWith(x) || x.startsWith(m)))).length;
      if (!communs) continue;
      const score = communs / Math.max(mots.size, cand.length);
      if (!meilleur || score > meilleur.score) meilleur = { id: p.id, libelle: p.libelle, score };
    }
  }
  return meilleur && meilleur.score >= 0.34 ? { id: meilleur.id, libelle: meilleur.libelle } : null;
}

export interface SaisieHorsCatalogue {
  cle: string;
  /** Les graphies rencontrées (les plus fréquentes d'abord). */
  textes: string[];
  occurrences: number;
  sites: number;
  derniere: Date | null;
  suggestion: { id: string; libelle: string } | null;
}

/**
 * SAISIES HORS CATALOGUE : les pièces saisies en texte libre que le
 * rapprochement n'a pas reconnues, regroupées par texte normalisé (« filtre
 * gasoil » et « Filtre  Gasoil » sont une seule entrée), les plus fréquentes
 * d'abord. C'est la file de travail de l'admin : un rattachement ajoute le
 * texte en SYNONYME, donc vaut aussi pour les saisies à venir.
 */
export async function saisiesHorsCatalogue(): Promise<SaisieHorsCatalogue[]> {
  const [libres, catalogue] = await Promise.all([
    prisma.pieceRechange.findMany({
      where: { pieceRefId: null },
      select: { nom: true, maintenance: { select: { siteId: true, dateFin: true, datePlanifiee: true } } },
    }),
    prisma.pieceRef.findMany({ where: { actif: true }, select: { id: true, libelle: true, synonymes: true } }),
  ]);
  const groupes = new Map<string, { textes: Map<string, number>; occurrences: number; sites: Set<string>; derniere: Date | null }>();
  for (const l of libres) {
    const cle = normaliserPiece(l.nom);
    if (!cle) continue;
    const g = groupes.get(cle) ?? { textes: new Map(), occurrences: 0, sites: new Set(), derniere: null };
    const brut = l.nom.trim().replace(/\s+/g, ' ');
    g.textes.set(brut, (g.textes.get(brut) ?? 0) + 1);
    g.occurrences++;
    g.sites.add(l.maintenance.siteId);
    const d = l.maintenance.dateFin ?? l.maintenance.datePlanifiee;
    if (d && (!g.derniere || d > g.derniere)) g.derniere = d;
    groupes.set(cle, g);
  }
  return [...groupes.entries()]
    .map(([cle, g]) => {
      const textes = [...g.textes.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
      return { cle, textes, occurrences: g.occurrences, sites: g.sites.size, derniere: g.derniere, suggestion: suggestionPiece(textes[0], catalogue) };
    })
    .sort((a, b) => b.occurrences - a.occurrences || a.textes[0].localeCompare(b.textes[0]));
}

/**
 * Rattache des textes libres à une pièce du catalogue : ils deviennent ses
 * SYNONYMES (refus si l'un désigne déjà une autre pièce), puis l'historique est
 * rapproché. Les saisies à venir avec la même graphie se rattacheront seules.
 */
export async function rattacherTextes(pieceId: string, textes: string[]): Promise<{ synonymes: string[]; rapprochees: number }> {
  const piece = await prisma.pieceRef.findUnique({ where: { id: pieceId }, select: { id: true, code: true, libelle: true, synonymes: true, actif: true } });
  if (!piece) throw new AppError('Pièce introuvable.', 404);
  if (!piece.actif) throw new AppError('Cette pièce est désactivée : réactivez-la avant d\'y rattacher des saisies.', 422);
  const synonymes = await validerSynonymes([...(piece.synonymes ?? []), ...textes], piece);
  await prisma.pieceRef.update({ where: { id: piece.id }, data: { synonymes } });
  const { rapprochees } = await rapprocherHistorique();
  return { synonymes, rapprochees };
}
