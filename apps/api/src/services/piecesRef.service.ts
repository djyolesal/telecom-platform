import { prisma } from '../config/database';

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
  const refs = await prisma.pieceRef.findMany({ where: { actif: true }, select: { id: true, code: true, libelle: true } });
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
