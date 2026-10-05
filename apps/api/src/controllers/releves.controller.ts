import { Request, Response, NextFunction } from 'express';
import { sitePerimetre, isRestreint, assertSiteInPerimetre } from '../utils/perimetre';
import { parseISO } from 'date-fns';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { dateBornee } from '../utils/dates';
import { idempotencyKey, memeAuteur } from '../utils/idempotency';
import { paginate } from '../utils/paginator';
import { triListe } from '../utils/triListe';
import { configCuveDuSite, litresPourHauteur } from '../services/cuve.service';
import { auditLog } from '../services/audit.service';
import { verifierClotureEnergie, enregistrerAnomalies, AvertissementSaisie } from '../services/vraisemblance.service';
import { sendTabular, EXPORT_MAX } from '../utils/exporter';
import { GE_PARAMS } from '../utils/calculator';
import { validerSaisieHorsApp } from '../utils/saisieHorsApp';
import { enregistrerReleveHorsApp } from '../services/releveHorsApp.service';

// Libellé court de la tâche préventive d'origine (pour la « provenance » du relevé).
const PROVENANCE_TACHE: Record<string, string> = {
  depotage: 'Dépotage',
  ge_production: 'Vidange GE',
  ge_secours: 'Vidange GE',
  curage_cuve: 'Curage cuve',
  tgbt_avr_onduleur: 'TGBT/AVR',
};

/**
 * Le CODE du site est réservé à l'administrateur (même règle que les exports) :
 * ni la liste des relevés, ni sa fiche ne le servent aux autres rôles. Les écrans
 * qui les affichent - web comme mobile - ne montrent que le NOM du site.
 */
function sansCodeSite<T extends { site?: unknown }>(releve: T, role: string | undefined): T {
  if (role === 'ADMIN' || !releve.site || typeof releve.site !== 'object') return releve;
  const { code: _code, ...site } = releve.site as Record<string, unknown>;
  return { ...releve, site } as T;
}

/** Provenance d'un relevé : d'où vient-il (dépotage, curative, préventive…) ? */
function provenanceReleve(m?: { type: string; tachePreventiveKey: string | null } | null, origine?: string | null): string {
  // Pris hors application et saisi après coup : l'origine de la SAISIE prime sur
  // celle de l'intervention - ce relevé n'est lié à aucune.
  if (origine === 'HORS_APP') return 'Hors application';
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
    const { site_id, source, search, date_debut, date_fin, page = '1', limit = '20' } =
      req.query as Record<string, string>;

    const where: Record<string, unknown> = {};
    if (site_id) where.siteId = site_id;
    if (source) where.source = source;
    const perimetre = await sitePerimetre(req.user!.id);
    if (search || isRestreint(perimetre)) {
      where.site = {
        ...(isRestreint(perimetre) ? perimetre : {}),
        ...(search ? { nom: { contains: search, mode: 'insensitive' } } : {}),
      };
    }
    if (date_debut || date_fin) {
      where.dateReleve = {
        ...(date_debut ? { gte: parseISO(date_debut) } : {}),
        ...(date_fin ? { lte: parseISO(date_fin) } : {}),
      };
    }

    // Tri d'en-tête délégué (liste blanche) ; défaut : relevés récents.
    // `siteNom`/`technicien` sont les clés d'affichage de la page web.
    const triExplicite = triListe(req.query, {
      siteNom: (s) => ({ site: { nom: s } }),
      dateReleve: (s) => ({ dateReleve: s }),
      technicien: (s) => ({ technicien: { nom: s } }),
      gasoilConsommeLitres: (s) => ({ gasoilConsommeLitres: s }),
      indexCompteur: (s) => ({ indexCompteur: s }),
      consommationKwh: (s) => ({ consommationKwh: s }),
      puissanceKva: (s) => ({ puissanceKva: s }),
    }, { dateReleve: 'desc' });

    const { data, meta } = await paginate(
      prisma.releveEnergie,
      {
        where,
        orderBy: triExplicite ?? { dateReleve: 'desc' },
        include: {
          site: { select: { nom: true, region: true, ...(req.user!.role === 'ADMIN' ? { code: true } : {}) } },
          technicien: { select: { nom: true, prenom: true } },
          maintenance: { select: { id: true, type: true, tachePreventiveKey: true } },
          groupe: { select: { numero: true } },
          saisiPar: { select: { nom: true, prenom: true } },
        },
      },
      { page: parseInt(page), limit: parseInt(limit) }
    );

    // Provenance (dépotage / curative / préventive…) déduite de la maintenance liée.
    const enriched = (data as { origine: string | null; maintenance?: { type: string; tachePreventiveKey: string | null } | null }[])
      .map((r) => ({ ...r, provenance: provenanceReleve(r.maintenance, r.origine) }));

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
        saisiPar: { select: { nom: true, prenom: true } },
        groupe: { select: { numero: true, puissanceKva: true } },
        maintenance: { select: { id: true, type: true, categorie: true, equipement: true, dateFin: true, tachePreventiveKey: true } },
      },
    });
    if (!releve) throw new AppError('Relevé introuvable', 404);
    await assertSiteInPerimetre(req.user!.id, releve.siteId);
    res.json({ success: true, data: sansCodeSite({ ...releve, provenance: provenanceReleve(releve.maintenance, releve.origine) }, req.user!.role) });
  } catch (err) { next(err); }
}

export async function createReleve(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as Record<string, unknown>;
    if (!b.siteId) throw new AppError('Site requis', 400);
    if (!b.source) throw new AppError('Source requise', 400);
    // Un relevé devient LE stock/index de référence du site (carte, prévisions,
    // alertes) : le réserver au périmètre de l'auteur.
    await assertSiteInPerimetre(req.user!.id, String(b.siteId));

    // Bornes : mêmes capacités que les colonnes Decimal (cf. import historique) —
    // évite qu'une saisie aberrante devienne le stock/index courant du site.
    const bounded = (v: unknown, max: number): number | null => {
      const n = v == null || v === '' ? null : Number(v);
      return n != null && Number.isFinite(n) && n >= 0 && n < max ? n : null;
    };

    // Idempotence (header Idempotency-Key → id) : un rejeu retrouve le relevé créé.
    const clientUuid = idempotencyKey(req);
    if (clientUuid) {
      const deja = memeAuteur(await prisma.releveEnergie.findUnique({ where: { id: clientUuid } }), req.user!.id);
      if (deja) return res.status(200).json({ success: true, data: deja, idempotent: true });
    }

    // Hauteur de gasoil mesurée (cm) : quand la cuve du site est calculable,
    // LE SERVEUR fait foi pour les litres (même moteur que le web et le
    // mobile) — la mesure brute est conservée à côté, ce qui permettra un
    // recalcul si le barème de la cuve est corrigé plus tard.
    const hauteurCuveCm = bounded(b.hauteurCuveCm, 1e4);
    let volumeGasoil = bounded(b.volumeGasoilLitres, 1e6);
    if (hauteurCuveCm != null) {
      const calc = litresPourHauteur(await configCuveDuSite(String(b.siteId)), hauteurCuveCm);
      if (calc != null) volumeGasoil = calc;
    }

    // Liste blanche stricte : jamais de gasoilConsommeLitres/isSynced/technicienId
    // arbitraires depuis le client (mass-assignment fermé).
    const coutEstime = estimerCout({ ...b, volumeGasoilLitres: volumeGasoil });
    const releve = await prisma.releveEnergie.create({
      data: {
        ...(clientUuid ? { id: clientUuid } : {}),
        siteId: String(b.siteId),
        source: b.source as never,
        dateReleve: dateBornee(b.dateReleve),
        technicienId: req.user!.id, // toujours l'utilisateur courant
        groupeId: b.groupeId ? String(b.groupeId) : null,
        indexCompteur: bounded(b.indexCompteur, 1e8),
        indexHeuresGE: bounded(b.indexHeuresGE, 1e9),
        volumeGasoilLitres: volumeGasoil,
        hauteurCuveCm,
        puissanceKva: bounded(b.puissanceKva, 1e4),
        observations: b.observations ? String(b.observations) : null,
        latitude: b.latitude != null ? Number(b.latitude) : null,
        longitude: b.longitude != null ? Number(b.longitude) : null,
        coutEstime,
      },
    });
    // ── CONTRÔLE DE VRAISEMBLANCE, jusqu'ici absent de cette porte d'entrée.
    //    Les clôtures de maintenance et les dépotages étaient vérifiés ; un
    //    index aberrant saisi ICI - portail ou mobile, hors intervention -
    //    passait sans un mot, et devenait la référence du site.
    //
    //    On n'exige PAS de confirmation : contrairement à une clôture, il n'y a
    //    pas de formulaire à reprendre, et refuser le relevé perdrait la
    //    mesure. On l'enregistre, on signale l'anomalie, et l'appelant la voit
    //    dans la réponse.
    const site = await prisma.site.findUnique({
      where: { id: String(b.siteId) },
      select: { id: true, cuveVolumeLitres: true, groupes: { select: { id: true, numero: true } } },
    });
    let avertissements: AvertissementSaisie[] = [];
    if (site) {
      avertissements = await verifierClotureEnergie(
        site,
        {
          volumeGasoilLitres: volumeGasoil,
          indexCompteur: bounded(b.indexCompteur, 1e8),
          indexHeuresGE: bounded(b.indexHeuresGE, 1e9),
          ...(b.groupeId ? { geHours: { [String(b.groupeId)]: bounded(b.indexHeuresGE, 1e9) } } : {}),
        },
        [String(b.source)],
        { releveId: releve.id },   // on ne se compare pas à soi-même
      );
      await enregistrerAnomalies(avertissements, {
        source: 'RELEVE', siteId: site.id, releveId: releve.id,
        technicienId: req.user!.id, confirmee: false,
      });
    }

    await auditLog(req.user!.id, 'CREATE', 'releves', releve.id,
      { siteId: b.siteId, source: b.source, ...(avertissements.length ? { anomalies: avertissements.map((a) => a.code) } : {}) }, req);
    res.status(201).json({ success: true, data: releve, ...(avertissements.length ? { avertissements } : {}) });
  } catch (err) { next(err); }
}

/**
 * Relevé pris sur le terrain HORS application, enregistré par un administrateur
 * (fiche papier, message, rattrapage). Voir `releveHorsApp.service` pour ce qui
 * distingue cette entrée de la saisie courante : date de la mesure, insertion
 * dans la chaîne des relevés, provenance tracée.
 *
 * Sans `confirmerVraisemblance: true`, une valeur inhabituelle (index qui
 * recule, jauge au-dessus de la cuve, bond impossible) est renvoyée en 422 et
 * RIEN n'est écrit : un chiffre recopié à la main se trompe plus souvent qu'un
 * chiffre lu à l'écran.
 */
export async function createReleveHorsApp(req: Request, res: Response, next: NextFunction) {
  try {
    const saisie = validerSaisieHorsApp(req.body);
    const confirme = (req.body as { confirmerVraisemblance?: unknown }).confirmerVraisemblance === true;
    const r = await enregistrerReleveHorsApp(saisie, req.user!.id, confirme);

    if (r.statut === 'CONFIRMATION_REQUISE') {
      return res.status(422).json({
        success: false,
        error: 'Certaines valeurs saisies semblent inhabituelles - vérifiez puis confirmez.',
        confirmationRequise: true,
        avertissements: r.avertissements,
      });
    }

    await auditLog(req.user!.id, 'CREATE', 'releves', r.releves[0]?.id, {
      horsApp: true,
      siteId: saisie.siteId,
      dateReleve: saisie.dateReleve.toISOString(),
      sources: [...new Set(r.releves.map((x) => x.source))],
      ...(r.avertissements.length ? { anomaliesConfirmees: r.avertissements.map((a) => a.code) } : {}),
    }, req);

    res.status(201).json({
      success: true,
      data: r.releves,
      ...(r.avertissements.length ? { avertissements: r.avertissements } : {}),
    });
  } catch (err) { next(err); }
}

export async function exportReleves(req: Request, res: Response, next: NextFunction) {
  try {
    const { site_id, source, search, date_debut, date_fin } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (site_id) where.siteId = site_id;
    if (source) where.source = source;
    if (date_debut || date_fin) {
      where.dateReleve = {
        ...(date_debut ? { gte: parseISO(date_debut) } : {}),
        ...(date_fin ? { lte: parseISO(date_fin) } : {}),
      };
    }
    // Même périmètre et mêmes filtres que la liste - l'export contournait le
    // filtre prestataire (et ignorait recherche/période).
    const perimetreExp = await sitePerimetre(req.user!.id);
    if (search || isRestreint(perimetreExp)) {
      where.site = {
        ...(isRestreint(perimetreExp) ? perimetreExp : {}),
        ...(search ? { nom: { contains: search, mode: 'insensitive' } } : {}),
      };
    }

    const rows = await prisma.releveEnergie.findMany({
      where,
      take: EXPORT_MAX,
      orderBy: { dateReleve: 'desc' },
      include: { site: { select: { nom: true } }, maintenance: { select: { type: true, tachePreventiveKey: true } } },
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
        { header: 'Hauteur cuve (cm)', key: 'hauteurCuve', width: 16 },
        { header: 'Heures GE', key: 'heures', width: 10 },
        { header: 'Coût estimé', key: 'cout', width: 14 },
      ],
      rows: rows.map((r) => ({
        site: r.site?.nom ?? '',
        date: r.dateReleve.toLocaleString('fr-FR'),
        provenance: provenanceReleve(r.maintenance, r.origine),
        source: r.source,
        index: r.indexCompteur != null ? Number(r.indexCompteur) : '',
        kwh: r.consommationKwh != null ? Number(r.consommationKwh) : '',
        gasoil: r.volumeGasoilLitres != null ? Number(r.volumeGasoilLitres) : '',
        hauteurCuve: r.hauteurCuveCm != null ? Number(r.hauteurCuveCm) : '',
        heures: r.heuresFonctGE != null ? Number(r.heuresFonctGE) : '',
        cout: r.coutEstime != null ? Number(r.coutEstime) : '',
      })),
    }]);
  } catch (err) { next(err); }
}
