import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { auditLog } from '../services/audit.service';
import { sendTabular } from '../utils/exporter';
import { getNum } from '../services/settings.service';

/** Vue unifiée d'un actif (GE ou équipement) pour le registre. */
interface ActifDTO {
  id: string;
  actifType: string; // 'GE' | 'BATTERIE' | 'CLIMATISEUR' | …
  categorie: string;
  numeroSerie: string | null;
  libelle: string | null;
  caracteristique: string | null;
  statutActif: string;
  siteId: string | null;
  site: { code: string; nom: string } | null;
  numero: number | null;
  marque: string | null;
  updatedAt: Date | null;
  /// GE uniquement : heures de marche depuis la dernière vidange confirmée.
  heuresDepuisVidange: number | null;
  vidangeDue: boolean;
  /// GE uniquement : dernier index horaire relevé (carte GE).
  dernierIndexHeures: number | null;
}

const geToDTO = (g: {
  id: string; puissanceKva: unknown; numeroSerie: string | null; statutActif: string; numero: number;
  siteId: string | null; site: { code: string; nom: string } | null;
  marque?: string | null; updatedAt?: Date; indexHeuresDerniereVidange?: unknown;
}, dernierIndex?: Map<string, number>, seuilVidange = 250): ActifDTO => {
  const heures =
    g.indexHeuresDerniereVidange != null && dernierIndex?.get(g.id) != null
      ? Math.max(0, dernierIndex.get(g.id)! - Number(g.indexHeuresDerniereVidange))
      : null;
  return ({
  id: g.id,
  actifType: 'GE',
  categorie: 'GE',
  numeroSerie: g.numeroSerie,
  libelle: `GE n°${g.numero} · ${Math.round(Number(g.puissanceKva))} kVA`,
  caracteristique: `${Math.round(Number(g.puissanceKva))} kVA`,
  statutActif: g.statutActif,
  siteId: g.siteId,
  site: g.site,
  numero: g.numero,
  marque: g.marque ?? null,
  updatedAt: g.updatedAt ?? null,
  heuresDepuisVidange: heures,
  vidangeDue: heures != null && heures >= seuilVidange,
  dernierIndexHeures: dernierIndex?.get(g.id) ?? null,
});
};

const equipToDTO = (e: {
  id: string; categorie: string; numeroSerie: string | null; libelle: string | null;
  valeur: unknown; unite: string | null; statutActif: string;
  siteId: string | null; site: { code: string; nom: string } | null;
  updatedAt?: Date;
}): ActifDTO => ({
  id: e.id,
  actifType: e.categorie,
  categorie: e.categorie,
  numeroSerie: e.numeroSerie,
  libelle: e.libelle,
  caracteristique: e.valeur != null ? `${Number(e.valeur)} ${e.unite ?? ''}`.trim() : null,
  statutActif: e.statutActif,
  siteId: e.siteId,
  site: e.site,
  numero: null,
  marque: null,
  updatedAt: e.updatedAt ?? null,
  heuresDepuisVidange: null,
  vidangeDue: false,
  dernierIndexHeures: null,
});

/** Liste du parc d'actifs (GE + équipements), filtrable par type / statut / site. */
async function fetchActifs(query: Record<string, string>): Promise<ActifDTO[]> {
  const { type, statut, site_id, en_stock, limit } = query;
  const siteSel = { select: { code: true, nom: true } };
  const out: ActifDTO[] = [];
  // Borne anti-surcharge large : couvre tout le parc réaliste pour ne pas tronquer
  // silencieusement les sélecteurs d'actifs (qui chargent toute la liste filtrée).
  const take = Math.min(Math.max(parseInt(limit || '2000', 10) || 2000, 1), 5000);

  // en_stock prime sur site_id (filtres mutuellement exclusifs : dépôt = sans site).
  const siteClause = en_stock === 'true' ? { siteId: null } : site_id ? { siteId: site_id } : {};
  const statutClause = statut ? { statutActif: statut as never } : {};

  const wantGE = !type || type === 'GE';
  const wantEquip = !type || type !== 'GE';

  if (wantGE) {
    const ges = await prisma.groupeElectrogene.findMany({
      where: { ...statutClause, ...siteClause },
      include: { site: siteSel },
      orderBy: { createdAt: 'desc' },
      take,
    });
    // Dernier index horaire relevé par GE → compteur « heures depuis vidange ».
    const releves = await prisma.releveEnergie.findMany({
      where: { source: 'GE', groupeId: { in: ges.map((g) => g.id) }, indexHeuresGE: { not: null } },
      orderBy: { dateReleve: 'desc' },
      select: { groupeId: true, indexHeuresGE: true },
    });
    const dernierIndex = new Map<string, number>();
    for (const r of releves) {
      if (r.groupeId && !dernierIndex.has(r.groupeId)) dernierIndex.set(r.groupeId, Number(r.indexHeuresGE));
    }
    const seuilVidange = getNum('ge.intervalleVidangeHeures', 250);
    out.push(...ges.map((g) => geToDTO(g, dernierIndex, seuilVidange)));
  }
  if (wantEquip) {
    const eqs = await prisma.equipementActif.findMany({
      where: { ...(type && type !== 'GE' ? { categorie: type as never } : {}), ...statutClause, ...siteClause },
      include: { site: siteSel },
      orderBy: { createdAt: 'desc' },
      take,
    });
    out.push(...eqs.map(equipToDTO));
  }
  return out;
}

export async function listActifs(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await fetchActifs(req.query as Record<string, string>) });
  } catch (err) { next(err); }
}

/** Export du registre du parc (mêmes filtres que la liste). */
export async function exportActifs(req: Request, res: Response, next: NextFunction) {
  try {
    const actifs = await fetchActifs(req.query as Record<string, string>);
    const LABELS: Record<string, string> = { EN_SERVICE: 'En service', EN_STOCK: 'Au dépôt', EN_TRANSIT: 'En transit', REFORME: 'Réformé' };
    await sendTabular(res, req.params.format as 'xlsx' | 'pdf', 'parc-actifs', "Parc d'actifs", [{
      name: 'Parc',
      columns: [
        { header: 'Site', key: 'site', width: 24 },
        { header: 'N° GE', key: 'numero', width: 8 },
        { header: 'Type', key: 'type', width: 16 },
        { header: 'N° série', key: 'serie', width: 16 },
        { header: 'Marque', key: 'marque', width: 14 },
        { header: 'Caractéristique', key: 'carac', width: 16 },
        { header: 'Statut', key: 'statut', width: 12 },
        { header: 'Index heures (h)', key: 'index', width: 14 },
        { header: 'Vidange (h)', key: 'vidange', width: 12 },
      ],
      rows: actifs.map((a) => ({
        site: a.site ? `${a.site.code} — ${a.site.nom}` : 'Dépôt',
        numero: a.numero ?? '',
        type: a.actifType === 'GE' ? `GE ${a.caracteristique ?? ''}`.trim() : (a.libelle ?? a.categorie),
        serie: a.numeroSerie ?? '',
        marque: a.marque ?? '',
        carac: a.caracteristique ?? '',
        statut: LABELS[a.statutActif] ?? a.statutActif,
        index: a.dernierIndexHeures != null ? Math.round(a.dernierIndexHeures) : '',
        vidange: a.heuresDepuisVidange != null ? Math.round(a.heuresDepuisVidange) : '',
      })),
    }]);
  } catch (err) { next(err); }
}

/** Détail d'un actif + son historique de mouvements (maintenances de cycle de vie). */
export async function getActif(req: Request, res: Response, next: NextFunction) {
  try {
    const { type, id } = req.params;
    const siteSel = { select: { code: true, nom: true } };

    let actif: ActifDTO | null = null;
    if (type === 'GE') {
      const g = await prisma.groupeElectrogene.findUnique({ where: { id }, include: { site: siteSel } });
      if (g) actif = geToDTO(g);
    } else {
      // Le type de l'URL doit correspondre à la catégorie de l'équipement.
      const e = await prisma.equipementActif.findUnique({ where: { id }, include: { site: siteSel } });
      if (e && e.categorie === type) actif = equipToDTO(e);
    }
    if (!actif) throw new AppError('Actif introuvable', 404);

    // Historique : maintenances de cycle de vie ciblant cet actif (borné).
    const mouvements = await prisma.maintenance.findMany({
      where: { actifId: id, natureTravaux: { not: 'ENTRETIEN' } },
      orderBy: [{ dateFin: 'desc' }, { datePlanifiee: 'desc' }],
      take: 100,
      select: {
        id: true, natureTravaux: true, statut: true, datePlanifiee: true, dateFin: true,
        siteId: true, siteSourceId: true,
        site: siteSel,
        technicien: { select: { nom: true, prenom: true } },
      },
    });
    // Résout les noms des sites d'origine (siteSourceId est un scalaire, pas une relation).
    const srcIds = [...new Set(mouvements.map((m) => m.siteSourceId).filter(Boolean) as string[])];
    const srcSites = srcIds.length
      ? await prisma.site.findMany({ where: { id: { in: srcIds } }, select: { id: true, code: true, nom: true } })
      : [];
    const srcMap = new Map(srcSites.map((s) => [s.id, { code: s.code, nom: s.nom }]));

    const historique = mouvements.map((m) => ({
      ...m,
      siteSource: m.siteSourceId ? srcMap.get(m.siteSourceId) ?? null : null,
    }));

    res.json({ success: true, data: { ...actif, historique } });
  } catch (err) { next(err); }
}

/** Enregistre un nouvel actif (GE ou équipement), au dépôt ou directement sur un site. */
export async function createActif(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as Record<string, unknown>;
    const actifType = String(b.actifType ?? '');
    const siteId = b.siteId ? String(b.siteId) : null;
    const statutActif = siteId ? 'EN_SERVICE' : 'EN_STOCK';

    let created;
    if (actifType === 'GE') {
      // Au dépôt : numéro sentinel 0 (le vrai numéro est attribué à la pose).
      // Sur un site : prochain numéro libre.
      let numero = 0;
      if (siteId) {
        const agg = await prisma.groupeElectrogene.aggregate({ where: { siteId }, _max: { numero: true } });
        numero = (agg._max.numero ?? 0) + 1;
      }
      created = await prisma.groupeElectrogene.create({
        data: {
          siteId,
          numero,
          puissanceKva: b.puissanceKva != null ? Number(b.puissanceKva) : 0,
          statut: (b.statut as never) ?? 'GE_SECOURS',
          numeroSerie: b.numeroSerie ? String(b.numeroSerie) : null,
          statutActif,
          isActive: !!siteId,
        },
      });
    } else if (actifType === 'BATTERIE' || actifType === 'CLIMATISEUR') {
      created = await prisma.equipementActif.create({
        data: {
          categorie: actifType,
          numeroSerie: b.numeroSerie ? String(b.numeroSerie) : null,
          libelle: b.libelle ? String(b.libelle) : null,
          valeur: b.valeur != null ? Number(b.valeur) : null,
          unite: b.unite ? String(b.unite) : null,
          statutActif,
          siteId,
          isActive: !!siteId,
        },
      });
    } else {
      throw new AppError('Type d\'actif non géré (GE, BATTERIE ou CLIMATISEUR).', 422);
    }

    await auditLog(req.user!.id, 'CREATE', 'actifs', created.id, { actifType }, req);
    res.status(201).json({ success: true, data: created });
  } catch (err) { next(err); }
}
