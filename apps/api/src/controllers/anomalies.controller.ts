import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { sitePerimetre, isRestreint } from '../utils/perimetre';
import { sendTabular } from '../utils/exporter';

/** Statuts de traitement : à vérifier, justifiée (explication reçue), à corriger. */
const STATUTS = ['A_VERIFIER', 'JUSTIFIEE', 'A_CORRIGER'] as const;

/**
 * Filtre COMMUN à la liste et à l'export : l'export sort exactement ce que
 * l'écran montre (statut, anomalie, origine, site, prestataire, mois),
 * toujours borné au périmètre de l'utilisateur.
 */
async function filtreAnomalies(req: Request): Promise<Record<string, unknown>> {
  const { statut, code, source, site_id, prestataire_id, mois } = req.query as Record<string, string>;
  const bornes: Record<string, Date> = {};
  if (/^\d{4}-\d{2}$/.test(mois ?? '')) {
    const [a, m] = mois.split('-').map(Number);
    bornes.gte = new Date(a, m - 1, 1);
    bornes.lt = new Date(a, m, 1);
  }
  const perimetre = await sitePerimetre(req.user!.id);
  return {
    ...(statut ? { statut } : {}),
    ...(code ? { code } : {}),
    ...(source ? { source } : {}),
    ...(site_id ? { siteId: site_id } : {}),
    ...(Object.keys(bornes).length ? { createdAt: bornes } : {}),
    ...(isRestreint(perimetre) || prestataire_id
      ? {
          site: {
            ...(isRestreint(perimetre) ? perimetre : {}),
            ...(prestataire_id
              ? { lot: { assignments: { some: { prestataireId: prestataire_id } } } }
              : {}),
          },
        }
      : {}),
  };
}

/**
 * ANOMALIES DE SAISIE : ce que les contrôles de vraisemblance ont relevé, et
 * ce que la supervision en a fait.
 *
 * L'intérêt n'est pas la ligne isolée - une valeur inhabituelle peut être
 * parfaitement légitime - mais le TRAITEMENT : chaque anomalie doit finir
 * justifiée ou corrigée, et la récurrence d'un même code sur un même site est
 * le vrai signal.
 */
export async function listerAnomalies(req: Request, res: Response, next: NextFunction) {
  try {
    const { page = '1', limit = '30' } = req.query as Record<string, string>;
    const where = await filtreAnomalies(req);

    const { data, meta } = await paginate(
      prisma.anomalieSaisie,
      {
        where,
        orderBy: { createdAt: 'desc' },
        include: { site: { select: { id: true, code: true, nom: true, region: true } } },
      },
      { page: parseInt(page), limit: parseInt(limit) },
    );

    // Le compteur « à vérifier » du MÊME filtre : sans lui, on ne sait pas si
    // la page qu'on regarde est la pointe d'une pile ou tout ce qu'il y a.
    const aVerifier = await prisma.anomalieSaisie.count({ where: { ...where, statut: 'A_VERIFIER' } });
    res.json({ success: true, data, meta: { ...meta, aVerifier } });
  } catch (err) { next(err); }
}

/** Répartition par code sur la période : c'est la RÉCURRENCE qui fait décider. */
export async function statsAnomalies(req: Request, res: Response, next: NextFunction) {
  try {
    const { mois } = req.query as Record<string, string>;
    const bornes: Record<string, Date> = {};
    if (/^\d{4}-\d{2}$/.test(mois ?? '')) {
      const [a, m] = mois.split('-').map(Number);
      bornes.gte = new Date(a, m - 1, 1);
      bornes.lt = new Date(a, m, 1);
    }
    const perimetre = await sitePerimetre(req.user!.id);
    const where = {
      ...(Object.keys(bornes).length ? { createdAt: bornes } : {}),
      ...(isRestreint(perimetre) ? { site: perimetre } : {}),
    };
    const parCode = await prisma.anomalieSaisie.groupBy({
      by: ['code', 'statut'],
      where,
      _count: { _all: true },
    });
    res.json({
      success: true,
      data: parCode.map((c) => ({ code: c.code, statut: c.statut, nombre: c._count._all })),
    });
  } catch (err) { next(err); }
}

/**
 * TRAITEMENT d'une anomalie : justifiée (avec le motif) ou à corriger.
 *
 * Le motif est EXIGÉ pour justifier : « compteur remplacé le 12/08 » vaut une
 * explication, un clic sans mot n'en est pas une - et c'est ce texte qu'on
 * relira dans six mois.
 */
export async function traiterAnomalie(req: Request, res: Response, next: NextFunction) {
  try {
    const { statut, motif } = req.body as { statut?: string; motif?: string };
    if (!STATUTS.includes(statut as typeof STATUTS[number])) {
      throw new AppError('Statut invalide (A_VERIFIER, JUSTIFIEE ou A_CORRIGER).', 422);
    }
    if (statut === 'JUSTIFIEE' && !String(motif ?? '').trim()) {
      throw new AppError('Indiquez ce qui justifie cette valeur (compteur remplacé, cuve agrandie…).', 422);
    }

    const perimetre = await sitePerimetre(req.user!.id);
    const existante = await prisma.anomalieSaisie.findFirst({
      where: { id: req.params.id, ...(isRestreint(perimetre) ? { site: perimetre } : {}) },
      select: { id: true, code: true, siteId: true },
    });
    if (!existante) throw new AppError('Anomalie introuvable.', 404);

    const anomalie = await prisma.anomalieSaisie.update({
      where: { id: existante.id },
      data: {
        statut,
        motifTraitement: String(motif ?? '').trim() || null,
        traiteePar: req.user!.id,
        traiteeLe: new Date(),
      },
      include: { site: { select: { id: true, code: true, nom: true, region: true } } },
    });
    await auditLog(req.user!.id, 'UPDATE', 'anomalies_saisie', anomalie.id,
      { statut, code: existante.code, motif: motif ?? null }, req);
    res.json({ success: true, data: anomalie });
  } catch (err) { next(err); }
}

/** Libellés lisibles des codes (miroir de l'écran Supervision → Anomalies). */
const LIBELLE_CODE: Record<string, string> = {
  CUVE_DEPASSEE: 'Cuve dépassée',
  INDEX_GE_RECULE: 'Index GE en baisse',
  HEURES_GE_ABERRANTES: "Bond d'heures GE",
  INDEX_CEET_RECULE: 'Index CEET en baisse',
  CONSO_CEET_ABERRANTE: 'Conso CEET aberrante',
  STOCK_AVANT_CUVE: 'Stock avant > cuve',
  STOCK_APRES_CUVE: 'Stock après > cuve',
  STOCK_AVANT_HAUSSE: 'Niveau remonté sans dépotage',
  DEPOTAGE_DOUBLON: 'Dépotage en double',
};
const LIBELLE_SOURCE: Record<string, string> = { MAINTENANCE: 'Clôture', DEPOTAGE: 'Dépotage', RELEVE: 'Relevé' };
const LIBELLE_STATUT: Record<string, string> = { A_VERIFIER: 'À vérifier', JUSTIFIEE: 'Justifiée', A_CORRIGER: 'À corriger' };

/** Colonnes de l'export (xlsx complet). */
const COLONNES = [
  { header: 'Date', key: 'date', width: 16 },
  { header: 'Code', key: 'code', width: 14 },
  { header: 'Site', key: 'site', width: 28 },
  { header: 'Région', key: 'region', width: 14 },
  { header: 'Anomalie', key: 'anomalie', width: 26 },
  { header: 'Détail', key: 'message', width: 60 },
  { header: 'Valeur saisie', key: 'valeurSaisie', width: 14 },
  { header: 'Valeur attendue', key: 'valeurAttendue', width: 22 },
  { header: 'Origine', key: 'origine', width: 11 },
  { header: 'Fiche', key: 'fiche', width: 22 },
  { header: 'Technicien', key: 'technicien', width: 22 },
  { header: 'Confirmée par le technicien', key: 'confirmee', width: 12 },
  { header: 'Statut', key: 'statut', width: 12 },
  { header: 'Motif du traitement', key: 'motif', width: 40 },
  { header: 'Traitée par', key: 'traiteePar', width: 18 },
  { header: 'Traitée le', key: 'traiteeLe', width: 16 },
];

/** Colonnes du PDF par défaut : de quoi lire et contrôler sur une page paysage. */
const COLONNES_PDF = new Set(['date', 'code', 'site', 'anomalie', 'message', 'fiche', 'technicien', 'statut', 'motif', 'traiteePar']);

/** Garde-fou de volume : au-delà, filtrer (mois, site) plutôt que tout sortir. */
const EXPORT_MAX = 20_000;

/**
 * EXPORT des anomalies de saisie (xlsx/pdf), avec les filtres de l'écran.
 * Ajoute ce que l'écran ne montre pas en colonne : la fiche d'origine
 * (MNT-/DEP-…), le technicien, qui a traité et quand - de quoi relire le
 * traitement sans rouvrir chaque ligne. Le code du site reste réservé à
 * l'ADMIN (règle commune des exports).
 */
export async function exportAnomalies(req: Request, res: Response, next: NextFunction) {
  try {
    const where = await filtreAnomalies(req);
    const lignes = await prisma.anomalieSaisie.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_MAX,
      include: { site: { select: { code: true, nom: true, region: true } } },
    });

    // Noms et références résolus en lot (le modèle ne porte que des ids).
    const uniques = (v: Array<string | null>) => [...new Set(v.filter((x): x is string => !!x))];
    const [users, maintenances, depotages] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: uniques(lignes.flatMap((l) => [l.technicienId, l.traiteePar])) } },
        select: { id: true, nom: true, prenom: true },
      }),
      prisma.maintenance.findMany({
        where: { id: { in: uniques(lignes.map((l) => l.maintenanceId)) } },
        select: { id: true, reference: true },
      }),
      prisma.depotage.findMany({
        where: { id: { in: uniques(lignes.map((l) => l.depotageId)) } },
        select: { id: true, reference: true },
      }),
    ]);
    const nom = new Map(users.map((u) => [u.id, `${u.prenom} ${u.nom}`.trim()]));
    const ref = new Map([...maintenances, ...depotages].map((x) => [x.id, x.reference ?? '']));
    const jour = (d: Date | null) => (d ? d.toLocaleString('fr-FR', { timeZone: 'Africa/Lome', dateStyle: 'short', timeStyle: 'short' }) : '');

    const aVerifier = lignes.filter((l) => l.statut === 'A_VERIFIER').length;
    await auditLog(req.user!.id, 'EXPORT', 'anomalies_saisie', undefined,
      { lignes: lignes.length, format: req.params.format, filtres: req.query }, req);

    await sendTabular(res, req.params.format, 'anomalies-saisie', 'Anomalies de saisie', [{
      name: 'Anomalies',
      // PDF sans choix explicite de colonnes : la version LISIBLE (le détail
      // porte déjà valeurs saisie/attendue, la région et la date de
      // traitement restent dans l'Excel). Cellules sur plusieurs lignes.
      columns: req.params.format === 'pdf' && !req.query.colonnes
        ? COLONNES.filter((c) => COLONNES_PDF.has(c.key))
        : COLONNES,
      retourLigne: true,
      rows: lignes.map((l) => ({
        date: jour(l.createdAt),
        code: l.site?.code ?? '',
        site: l.site?.nom ?? '',
        region: l.site?.region ?? '',
        anomalie: LIBELLE_CODE[l.code] ?? l.code,
        message: l.message,
        valeurSaisie: l.valeurSaisie != null ? Number(l.valeurSaisie) : '',
        valeurAttendue: l.valeurAttendue ?? '',
        origine: LIBELLE_SOURCE[l.source] ?? l.source,
        fiche: ref.get(l.maintenanceId ?? l.depotageId ?? '') ?? '',
        technicien: l.technicienId ? nom.get(l.technicienId) ?? '' : '',
        confirmee: l.confirmee ? 'Oui' : 'Non',
        statut: LIBELLE_STATUT[l.statut] ?? l.statut,
        motif: l.motifTraitement ?? '',
        traiteePar: l.traiteePar ? nom.get(l.traiteePar) ?? '' : '',
        traiteeLe: jour(l.traiteeLe),
      })),
    }], `${lignes.length} anomalie(s) · ${aVerifier} à vérifier${lignes.length === EXPORT_MAX ? ` · limité aux ${EXPORT_MAX} plus récentes` : ''}`);
  } catch (err) { next(err); }
}
