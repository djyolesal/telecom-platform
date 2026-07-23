import { Request, Response, NextFunction } from 'express';
import { sitePerimetre, isRestreint } from '../utils/perimetre';
import { parseISO } from 'date-fns';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { idempotencyKey } from '../utils/idempotency';
import { paginate } from '../utils/paginator';
import { auditLog } from '../services/audit.service';
import { sendTabular } from '../utils/exporter';
import { GE_PARAMS } from '../utils/calculator';

// Libellé court de la tâche préventive d'origine (pour la « provenance » du relevé).
const PROVENANCE_TACHE: Record<string, string> = {
  depotage: 'Dépotage',
  ge_production: 'Vidange GE',
  ge_secours: 'Vidange GE',
  curage_cuve: 'Curage cuve',
  tgbt_avr_onduleur: 'TGBT/AVR',
};

/** Provenance d'un relevé : d'où vient-il (dépotage, curative, préventive…) ? */
function provenanceReleve(m?: { type: string; tachePreventiveKey: string | null } | null): string {
  if (!m) return 'Autonome';
  if (m.type === 'CURATIVE') return 'Curative';
  if (m.tachePreventiveKey && PROVENANCE_TACHE[m.tachePreventiveKey]) return PROVENANCE_TACHE[m.tachePreventiveKey];
  return 'Préventive';
}

/** Estime le coût d'un relevé selon la source (gasoil pour GE, kWh CEET sinon). */
function estimerCout(data: Record<string, any>): number | null {
  if (data.coutEstime != null) return Math.round(Number(data.coutEstime));
  if (data.source === 'GE' && data.volumeGasoilLitres != null) {
    return Math.round(Number(data.volumeGasoilLitres) * GE_PARAMS.prixLitreFCFA);
  }
  if (data.source === 'CEET' && data.consommationKwh != null) {
    // Tarif CEET indicatif (FCFA/kWh) — paramétrable côté SystemSettings
    return Math.round(Number(data.consommationKwh) * 105);
  }
  return null;
}

export async function getReleves(req: Request, res: Response, next: NextFunction) {
  try {
    const { site_id, source, date_debut, date_fin, page = '1', limit = '20' } =
      req.query as Record<string, string>;

    const where: Record<string, unknown> = {};
    if (site_id) where.siteId = site_id;
    if (source) where.source = source;
    const perimetre = await sitePerimetre(req.user!.id);
    if (isRestreint(perimetre)) where.site = perimetre;
    if (date_debut || date_fin) {
      where.dateReleve = {
        ...(date_debut ? { gte: parseISO(date_debut) } : {}),
        ...(date_fin ? { lte: parseISO(date_fin) } : {}),
      };
    }

    const { data, meta } = await paginate(
      prisma.releveEnergie,
      {
        where,
        orderBy: { dateReleve: 'desc' },
        include: {
          site: { select: { nom: true, code: true, region: true } },
          technicien: { select: { nom: true, prenom: true } },
          maintenance: { select: { type: true, tachePreventiveKey: true } },
        },
      },
      { page: parseInt(page), limit: parseInt(limit) }
    );

    // Provenance (dépotage / curative / préventive…) déduite de la maintenance liée.
    const enriched = (data as { maintenance?: { type: string; tachePreventiveKey: string | null } | null }[])
      .map((r) => ({ ...r, provenance: provenanceReleve(r.maintenance) }));

    res.json({ success: true, data: enriched, meta });
  } catch (err) { next(err); }
}

export async function getReleveById(req: Request, res: Response, next: NextFunction) {
  try {
    const releve = await prisma.releveEnergie.findUnique({
      where: { id: req.params.id },
      include: {
        site: true,
        technicien: { select: { nom: true, prenom: true } },
        groupe: { select: { numero: true, puissanceKva: true } },
        maintenance: { select: { id: true, type: true, categorie: true, equipement: true, dateFin: true, tachePreventiveKey: true } },
      },
    });
    if (!releve) throw new AppError('Relevé introuvable', 404);
    res.json({ success: true, data: { ...releve, provenance: provenanceReleve(releve.maintenance) } });
  } catch (err) { next(err); }
}

export async function createReleve(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as Record<string, unknown>;
    if (!b.siteId) throw new AppError('Site requis', 400);
    if (!b.source) throw new AppError('Source requise', 400);

    // Bornes : mêmes capacités que les colonnes Decimal (cf. import historique) —
    // évite qu'une saisie aberrante devienne le stock/index courant du site.
    const bounded = (v: unknown, max: number): number | null => {
      const n = v == null || v === '' ? null : Number(v);
      return n != null && Number.isFinite(n) && n >= 0 && n < max ? n : null;
    };

    // Idempotence (header Idempotency-Key → id) : un rejeu retrouve le relevé créé.
    const clientUuid = idempotencyKey(req);
    if (clientUuid) {
      const deja = await prisma.releveEnergie.findUnique({ where: { id: clientUuid } });
      if (deja) return res.status(200).json({ success: true, data: deja, idempotent: true });
    }

    // Liste blanche stricte : jamais de gasoilConsommeLitres/isSynced/technicienId
    // arbitraires depuis le client (mass-assignment fermé).
    const coutEstime = estimerCout(b);
    const releve = await prisma.releveEnergie.create({
      data: {
        ...(clientUuid ? { id: clientUuid } : {}),
        siteId: String(b.siteId),
        source: b.source as never,
        dateReleve: b.dateReleve ? new Date(String(b.dateReleve)) : new Date(),
        technicienId: req.user!.id, // toujours l'utilisateur courant
        groupeId: b.groupeId ? String(b.groupeId) : null,
        indexCompteur: bounded(b.indexCompteur, 1e8),
        indexHeuresGE: bounded(b.indexHeuresGE, 1e9),
        volumeGasoilLitres: bounded(b.volumeGasoilLitres, 1e6),
        puissanceKva: bounded(b.puissanceKva, 1e4),
        observations: b.observations ? String(b.observations) : null,
        latitude: b.latitude != null ? Number(b.latitude) : null,
        longitude: b.longitude != null ? Number(b.longitude) : null,
        coutEstime,
      },
    });
    await auditLog(req.user!.id, 'CREATE', 'releves', releve.id, { siteId: b.siteId, source: b.source }, req);
    res.status(201).json({ success: true, data: releve });
  } catch (err) { next(err); }
}

export async function exportReleves(req: Request, res: Response, next: NextFunction) {
  try {
    const { site_id, source } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (site_id) where.siteId = site_id;
    if (source) where.source = source;

    const rows = await prisma.releveEnergie.findMany({
      where,
      orderBy: { dateReleve: 'desc' },
      include: { site: { select: { code: true } }, maintenance: { select: { type: true, tachePreventiveKey: true } } },
    });

    await auditLog(req.user!.id, 'EXPORT', 'releves', undefined, { count: rows.length }, req);
    await sendTabular(res, req.params.format, 'releves', 'Relevés énergie', [{
      name: 'Releves',
      columns: [
        { header: 'Site', key: 'site', width: 16 },
        { header: 'Date', key: 'date', width: 18 },
        { header: 'Provenance', key: 'provenance', width: 14 },
        { header: 'Source', key: 'source', width: 10 },
        { header: 'Index compteur', key: 'index', width: 14 },
        { header: 'Conso (kWh)', key: 'kwh', width: 12 },
        { header: 'Gasoil (L)', key: 'gasoil', width: 12 },
        { header: 'Heures GE', key: 'heures', width: 10 },
        { header: 'Coût estimé', key: 'cout', width: 14 },
      ],
      rows: rows.map((r) => ({
        site: r.site?.code ?? '',
        date: r.dateReleve.toLocaleString('fr-FR'),
        provenance: provenanceReleve(r.maintenance),
        source: r.source,
        index: r.indexCompteur != null ? Number(r.indexCompteur) : '',
        kwh: r.consommationKwh != null ? Number(r.consommationKwh) : '',
        gasoil: r.volumeGasoilLitres != null ? Number(r.volumeGasoilLitres) : '',
        heures: r.heuresFonctGE != null ? Number(r.heuresFonctGE) : '',
        cout: r.coutEstime != null ? Number(r.coutEstime) : '',
      })),
    }]);
  } catch (err) { next(err); }
}
