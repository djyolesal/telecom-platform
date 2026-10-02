import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';
import { sitePerimetre, isRestreint, contratMaintenancePerimetre } from '../utils/perimetre';
import { sendTabular, EXPORT_MAX } from '../utils/exporter';
import { L_TYPE_MAINTENANCE, L_STATUT_MAINTENANCE, libelle } from '../utils/libelles';
import { auditLog } from '../services/audit.service';
import { normaliserPiece } from '../services/piecesRef.service';

/**
 * LISTE DES PIÈCES CHANGÉES.
 *
 * Une ligne = une pièce posée lors d'une intervention (table `pieces_rechange`).
 * Les données existaient mais n'étaient lisibles qu'intervention par
 * intervention, ou agrégées dans le seul rapport mensuel PDF : il n'y avait
 * aucun endroit où poser la question « quelles pièces ont été changées, où, par
 * qui, sur la période ? ».
 *
 * RÈGLES, alignées sur le rapport mensuel :
 *  - une intervention INVALIDÉE ne compte nulle part (on ne facture pas un
 *    travail refusé) : exclue par défaut, visible sur demande et signalée ;
 *  - mêmes périmètres que la liste des maintenances : un prestataire ne voit
 *    que ses sites et son contrat ;
 *  - le CODE du site n'apparaît que pour l'ADMIN, comme dans tous les exports ;
 *  - AUCUN COÛT n'est servi ni exporté (décision de l'exploitant, 02/10/2026).
 *    La colonne `cout_unitaire` reste en base ; l'écran dit QUOI, OÙ, COMBIEN.
 */

/** Plafond des lignes agrégées pour la synthèse : au-delà, elle est signalée comme partielle. */
const SYNTHESE_MAX = 20_000;

const JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;

/** « 2026-09-30 » → minuit LOCAL, comme la fiche de validation qui borne ses mois sur l'heure du serveur. */
function jour(brut: string | undefined, nom: string): Date | null {
  if (!brut) return null;
  const m = brut.match(JOUR);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  if (!d || Number.isNaN(d.getTime())) throw new AppError(`${nom} invalide : AAAA-MM-JJ attendu.`, 422);
  return d;
}

/**
 * Filtre commun à l'écran, à la synthèse et à l'export - UN SEUL endroit : ils
 * ne doivent pas pouvoir répondre à deux questions différentes.
 */
async function filtre(req: Request): Promise<Prisma.PieceRechangeWhereInput> {
  const q = req.query as Record<string, string | undefined>;
  const estAdmin = req.user!.role === 'ADMIN';

  const debut = jour(q.date_debut, 'date_debut');
  const fin = jour(q.date_fin, 'date_fin');
  if (debut && fin && fin < debut) throw new AppError('La date de fin précède la date de début.', 422);
  // Fin INCLUSIVE : « jusqu'au 30 » comprend le 30 entier.
  const finExclue = fin ? new Date(fin.getFullYear(), fin.getMonth(), fin.getDate() + 1) : null;

  const perimetre = await sitePerimetre(req.user!.id);
  const maintenance: Prisma.MaintenanceWhereInput = {};
  const et: Prisma.MaintenanceWhereInput[] = [];

  // Une intervention se rattache à une date par sa FIN quand elle est close,
  // par sa date planifiée sinon : le même rattachement que la fiche de validation.
  if (debut || finExclue) {
    const bornes = { ...(debut ? { gte: debut } : {}), ...(finExclue ? { lt: finExclue } : {}) };
    et.push({ OR: [{ dateFin: bornes }, { dateFin: null, datePlanifiee: bornes }] });
  }
  if (q.inclure_invalidees !== '1') maintenance.invalideeLe = null;
  if (q.type === 'PREVENTIVE' || q.type === 'CURATIVE') maintenance.type = q.type;
  if (q.site_id) maintenance.siteId = q.site_id;
  if (q.prestataire_id) maintenance.prestataireId = q.prestataire_id;

  const site: Prisma.SiteWhereInput = {
    ...(isRestreint(perimetre) ? (perimetre as Prisma.SiteWhereInput) : {}),
    ...(q.region ? { region: q.region } : {}),
  };
  if (Object.keys(site).length) maintenance.site = site;
  // Cloisonnement par CONTRAT : sur un site partagé passif + solaire, chacun ne
  // voit que les interventions de son contrat.
  if (isRestreint(perimetre)) et.push((await contratMaintenancePerimetre(req.user!.id)) as Prisma.MaintenanceWhereInput);
  if (et.length) maintenance.AND = et;

  const where: Prisma.PieceRechangeWhereInput = { maintenance };
  if (q.piece_ref_id) where.pieceRefId = q.piece_ref_id;
  if (q.catalogue === 'oui') where.pieceRefId = { not: null };
  if (q.catalogue === 'non') where.pieceRefId = null;

  const recherche = q.search?.trim();
  if (recherche) {
    const contient = { contains: recherche, mode: 'insensitive' as const };
    where.OR = [
      { nom: contient },
      { reference: contient },
      { pieceRef: { libelle: contient } },
      { pieceRef: { code: contient } },
      { maintenance: { reference: contient } },
      { maintenance: { site: { nom: contient } } },
      // Le code d'un site ne se découvre pas par la recherche : la règle
      // « code réservé à l'admin » vaut aussi pour ce qu'on peut deviner.
      ...(estAdmin ? [{ maintenance: { site: { code: contient } } }] : []),
    ];
  }
  return where;
}

const SELECT_LIGNE = {
  id: true, nom: true, reference: true, quantite: true, pieceRefId: true,
  pieceRef: { select: { code: true, libelle: true } },
  maintenance: {
    select: {
      id: true, reference: true, type: true, statut: true, dateFin: true, datePlanifiee: true, invalideeLe: true,
      site: { select: { id: true, nom: true, code: true, region: true } },
      prestataire: { select: { id: true, nom: true } },
      technicien: { select: { nom: true, prenom: true } },
    },
  },
} satisfies Prisma.PieceRechangeSelect;

type Ligne = Prisma.PieceRechangeGetPayload<{ select: typeof SELECT_LIGNE }>;

const ORDRE: Prisma.PieceRechangeOrderByWithRelationInput[] = [
  { maintenance: { dateFin: { sort: 'desc', nulls: 'last' } } },
  { maintenance: { datePlanifiee: 'desc' } },
  { id: 'asc' },
];

/** La date que l'écran montre : la fin de l'intervention, à défaut sa date planifiée. */
const dateDe = (l: Ligne) => l.maintenance.dateFin ?? l.maintenance.datePlanifiee;

function versJson(l: Ligne, estAdmin: boolean) {
  const m = l.maintenance;
  return {
    id: l.id,
    nom: l.nom,
    reference: l.reference,
    quantite: l.quantite,
    catalogue: l.pieceRef ? { id: l.pieceRefId, code: l.pieceRef.code, libelle: l.pieceRef.libelle } : null,
    date: dateDe(l),
    invalidee: m.invalideeLe != null,
    maintenance: { id: m.id, reference: m.reference, type: m.type, statut: m.statut },
    site: { id: m.site.id, nom: m.site.nom, region: m.site.region, ...(estAdmin ? { code: m.site.code } : {}) },
    prestataire: m.prestataire ? { id: m.prestataire.id, nom: m.prestataire.nom } : null,
    technicien: m.technicien ? `${m.technicien.prenom} ${m.technicien.nom}` : null,
  };
}

/**
 * Synthèse par pièce sur TOUT le filtre (pas seulement la page affichée) : une
 * même pièce se regroupe par son rattachement au catalogue, à défaut par son
 * libellé normalisé - « Batterie 12 V 100 Ah » et « batterie 12v100ah » ne font
 * qu'une ligne, comme dans le rapprochement.
 */
async function synthese(where: Prisma.PieceRechangeWhereInput) {
  const lignes = await prisma.pieceRechange.findMany({
    where,
    take: SYNTHESE_MAX + 1,
    select: {
      nom: true, quantite: true, pieceRefId: true,
      pieceRef: { select: { libelle: true } },
      maintenance: { select: { id: true, siteId: true } },
    },
  });
  const partielle = lignes.length > SYNTHESE_MAX;
  if (partielle) lignes.length = SYNTHESE_MAX;

  type Agg = { cle: string; libelle: string; catalogue: boolean; quantite: number;
    interventions: Set<string>; sites: Set<string> };
  const parPiece = new Map<string, Agg>();
  const interventions = new Set<string>();
  const sites = new Set<string>();
  let quantiteTotale = 0;
  let sansCatalogue = 0;

  for (const l of lignes) {
    const cle = l.pieceRefId ?? `libre:${normaliserPiece(l.nom)}`;
    const a = parPiece.get(cle) ?? {
      cle, libelle: l.pieceRef?.libelle ?? l.nom, catalogue: l.pieceRefId != null,
      quantite: 0, interventions: new Set<string>(), sites: new Set<string>(),
    };
    a.quantite += l.quantite;
    a.interventions.add(l.maintenance.id);
    a.sites.add(l.maintenance.siteId);
    parPiece.set(cle, a);

    interventions.add(l.maintenance.id);
    sites.add(l.maintenance.siteId);
    quantiteTotale += l.quantite;
    if (!l.pieceRefId) sansCatalogue += 1;
  }

  return {
    partielle,
    totaux: {
      lignes: lignes.length,
      quantite: quantiteTotale,
      interventions: interventions.size,
      sites: sites.size,
      sansCatalogue,
    },
    parPiece: [...parPiece.values()]
      .map((a) => ({
        cle: a.cle, libelle: a.libelle, catalogue: a.catalogue, quantite: a.quantite,
        interventions: a.interventions.size, sites: a.sites.size,
      }))
      .sort((a, b) => b.quantite - a.quantite || a.libelle.localeCompare(b.libelle, 'fr')),
  };
}

export async function listPiecesChangees(req: Request, res: Response, next: NextFunction) {
  try {
    const { page = '1', limit = '50' } = req.query as Record<string, string>;
    const where = await filtre(req);
    const estAdmin = req.user!.role === 'ADMIN';

    const [{ data, meta }, resume] = await Promise.all([
      paginate<Ligne>(prisma.pieceRechange, { where, orderBy: ORDRE, select: SELECT_LIGNE }, {
        page: parseInt(page, 10), limit: parseInt(limit, 10),
      }),
      synthese(where),
    ]);

    res.json({ success: true, data: data.map((l) => versJson(l, estAdmin)), meta, synthese: resume });
  } catch (err) { next(err); }
}

const fmtJour = (d: Date) => d.toLocaleDateString('fr-FR', { timeZone: 'Africa/Lome' });

export async function exportPiecesChangees(req: Request, res: Response, next: NextFunction) {
  try {
    const where = await filtre(req);
    const [lignes, resume] = await Promise.all([
      prisma.pieceRechange.findMany({ where, orderBy: ORDRE, select: SELECT_LIGNE, take: EXPORT_MAX }),
      synthese(where),
    ]);
    const q = req.query as Record<string, string | undefined>;
    const avecInvalidees = q.inclure_invalidees === '1';

    await auditLog(req.user!.id, 'EXPORT', 'pieces_changees', undefined, { count: lignes.length, format: req.params.format }, req);

    const periode = q.date_debut || q.date_fin
      ? `du ${q.date_debut ? fmtJour(jour(q.date_debut, 'date_debut')!) : '…'} au ${q.date_fin ? fmtJour(jour(q.date_fin, 'date_fin')!) : '…'} · `
      : '';
    const reserve = lignes.length >= EXPORT_MAX ? ` · limité aux ${EXPORT_MAX} premières lignes, affinez la période` : '';
    const partielle = resume.partielle ? ' · synthèse partielle (volume trop élevé)' : '';

    await sendTabular(res, req.params.format, 'pieces-changees', 'Pièces changées', [
      {
        name: 'Pièces changées',
        columns: [
          { header: 'Date', key: 'date', width: 14 },
          { header: 'Site', key: 'site', width: 22 },
          // Clé « code » : retirée par sendTabular hors ADMIN.
          { header: 'Code', key: 'code', width: 12 },
          { header: 'Région', key: 'region', width: 14 },
          { header: 'Prestataire', key: 'prestataire', width: 18 },
          { header: 'Intervention', key: 'intervention', width: 16 },
          { header: 'Type', key: 'type', width: 11 },
          { header: 'Statut', key: 'statut', width: 13 },
          { header: 'Pièce', key: 'piece', width: 28 },
          { header: 'Référence', key: 'reference', width: 16 },
          { header: 'Catalogue', key: 'catalogue', width: 24 },
          { header: 'Quantité', key: 'quantite', width: 12 },
          { header: 'Technicien', key: 'technicien', width: 18 },
          ...(avecInvalidees ? [{ header: 'Validité', key: 'validite', width: 12 }] : []),
        ],
        rows: lignes.map((l) => ({
          date: fmtJour(dateDe(l)),
          site: l.maintenance.site.nom,
          code: l.maintenance.site.code,
          region: l.maintenance.site.region,
          prestataire: l.maintenance.prestataire?.nom ?? '',
          intervention: l.maintenance.reference ?? '',
          type: libelle(L_TYPE_MAINTENANCE, l.maintenance.type),
          statut: libelle(L_STATUT_MAINTENANCE, l.maintenance.statut),
          piece: l.nom,
          reference: l.reference ?? '',
          catalogue: l.pieceRef ? l.pieceRef.libelle : 'Hors catalogue',
          quantite: l.quantite,
          technicien: l.maintenance.technicien ? `${l.maintenance.technicien.prenom} ${l.maintenance.technicien.nom}` : '',
          validite: l.maintenance.invalideeLe ? 'Invalidée' : 'Valide',
        })),
      },
      {
        name: 'Synthèse par pièce',
        columns: [
          { header: 'Pièce', key: 'libelle', width: 34 },
          { header: 'Catalogue', key: 'catalogue', width: 12 },
          { header: 'Quantité', key: 'quantite', width: 12 },
          { header: 'Interventions', key: 'interventions', width: 14 },
          { header: 'Sites', key: 'sites', width: 8 },
        ],
        rows: resume.parPiece.map((p) => ({
          libelle: p.libelle,
          catalogue: p.catalogue ? 'Oui' : 'Non',
          quantite: p.quantite,
          interventions: p.interventions,
          sites: p.sites,
        })),
      },
    ], `${periode}${resume.totaux.quantite} pièce(s) sur ${resume.totaux.interventions} intervention(s) et ${resume.totaux.sites} site(s)${reserve}${partielle}`);
  } catch (err) { next(err); }
}
