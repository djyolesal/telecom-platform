import { Request, Response, NextFunction } from 'express';
import { sitePerimetre, assertSiteInPerimetre } from '../utils/perimetre';
import { sourcesForConfig } from '../utils/energy';
import { ScopeMaintenance } from '@prisma/client';
import { addMonths } from 'date-fns';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { auditLog } from '../services/audit.service';
import { genererPlanningPreventif } from '../services/planning.service';
import { dateReferenceTaches } from '../services/settings.service';
import JSZip from 'jszip';
import { buildFicheValidationXlsx, FicheLogo } from '../services/ficheValidation.service';
import { getObjectBuffer } from '../services/storage.service';
import { setXlsxHeaders } from '../utils/excel';

/** Charge un logo (objet MinIO) et déduit son extension pour ExcelJS. */
async function loadLogo(key?: string | null): Promise<FicheLogo | null> {
  if (!key) return null;
  try {
    const buffer = await getObjectBuffer(key);
    const ext: FicheLogo['extension'] = /\.png$/i.test(key) ? 'png' : /\.gif$/i.test(key) ? 'gif' : 'jpeg';
    return { buffer, extension: ext };
  } catch {
    return null;
  }
}
import {
  TASK_BY_KEY,
  FREQUENCE_MOIS,
  FREQUENCE_LABEL,
  tachesForSite,
  tachesPlanifiables,
  effectiveCatalogue,
  SiteEligibilite,
  exigePremiereManuelle,
} from '../utils/tachesPreventives';

const SCOPES_PASSIFS: ScopeMaintenance[] = ['PASSIVE', 'LES_DEUX'];

/**
 * Suivi « validé par les données » (tâche dépotage) : jetons du MOIS COURANT
 * par site - 'LIV' (un dépotage), 'GE' (relevé GE avec carburant), 'CEET'.
 * Le mois est validé par une livraison OU un relevé complet selon la config.
 */
async function jetonsSuiviMoisCourant(siteIds: string[]): Promise<Map<string, Set<string>>> {
  const debut = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [deps, rels] = await Promise.all([
    prisma.depotage.findMany({ where: { siteId: { in: siteIds }, dateDepotage: { gte: debut } }, select: { siteId: true } }),
    prisma.releveEnergie.findMany({
      where: { siteId: { in: siteIds }, dateReleve: { gte: debut }, source: { in: ['GE', 'CEET'] } },
      select: { siteId: true, source: true, volumeGasoilLitres: true },
    }),
  ]);
  const vus = new Map<string, Set<string>>();
  const poser = (id: string, tok: string) => (vus.get(id) ?? vus.set(id, new Set()).get(id)!).add(tok);
  for (const d of deps) poser(d.siteId, 'LIV');
  for (const r of rels) {
    if (r.source === 'GE') { if (r.volumeGasoilLitres != null) poser(r.siteId, 'GE'); }
    else poser(r.siteId, 'CEET');
  }
  return vus;
}

function suiviMoisValide(vus: Set<string> | undefined, powerConfig: string): boolean {
  if (!vus) return false;
  if (vus.has('LIV')) return true;
  const requises = sourcesForConfig(powerConfig).filter((x) => x === 'GE' || x === 'CEET');
  return requises.length > 0 && requises.every((x) => vus.has(x));
}

/** Statut d'échéance d'une tâche pour un site. */
type StatutEcheance = 'JAMAIS' | 'EN_RETARD' | 'A_JOUR';

function statutEcheance(lastDone: Date | null, freqMois: number | null, now: Date): { statut: StatutEcheance; prochaine: Date | null } {
  if (freqMois == null) return { statut: lastDone ? 'A_JOUR' : 'JAMAIS', prochaine: null }; // au besoin
  if (!lastDone) return { statut: 'JAMAIS', prochaine: now };
  const prochaine = addMonths(lastDone, freqMois);
  return { statut: prochaine < now ? 'EN_RETARD' : 'A_JOUR', prochaine };
}

/** Catalogue contractuel (libellé/fréquence effectifs — surchargeables par l'admin). */
export async function getCatalogue(_req: Request, res: Response) {
  res.json({
    success: true,
    data: effectiveCatalogue().map((t) => ({
      numero: t.numero,
      key: t.key,
      libelle: t.libelle,
      categorie: t.categorie,
      frequence: t.frequence,
      frequenceLabel: FREQUENCE_LABEL[t.frequence],
      cible: t.cible,
    })),
  });
}

/** Tâches contractuelles applicables à un site + dernière exécution / prochaine échéance. */
export async function getTachesForSite(req: Request, res: Response, next: NextFunction) {
  try {
    await assertSiteInPerimetre(req.user!.id, req.params.id);
    const site = await prisma.site.findUnique({ where: { id: req.params.id } });
    if (!site) throw new AppError('Site introuvable', 404);

    const applicables = tachesForSite(site as unknown as SiteEligibilite);
    // Dernières exécutions terminées par clé de tâche pour ce site.
    const done = await prisma.maintenance.groupBy({
      by: ['tachePreventiveKey'],
      // Une clôture invalidée n'est pas une exécution valide (cohérent avec
      // le rapport de conformité et le planificateur).
      where: { siteId: site.id, statut: 'TERMINEE', invalideeLe: null, tachePreventiveKey: { in: applicables.map((t) => t.key) } },
      _max: { dateFin: true },
    });
    const lastByKey = new Map(done.map((d) => [d.tachePreventiveKey, d._max.dateFin]));
    const now = new Date();
    const jetons = applicables.some((t) => t.suiviParDonnees)
      ? await jetonsSuiviMoisCourant([site.id])
      : new Map<string, Set<string>>();

    res.json({
      success: true,
      data: applicables.map((t) => {
        // Suivi par les données : le statut du mois vient des relevés/dépotages.
        if (t.suiviParDonnees) {
          const ok = suiviMoisValide(jetons.get(site.id), site.powerConfig);
          return {
            numero: t.numero, key: t.key, libelle: t.libelle, categorie: t.categorie,
            frequence: t.frequence, frequenceLabel: FREQUENCE_LABEL[t.frequence],
            derniereExecution: null, prochaineEcheance: null,
            statut: ok ? 'A_JOUR' : 'EN_RETARD',
            suiviParDonnees: true,
          };
        }
        // Jamais enregistrée : mensuelle → réputée faite à la date de
        // référence ; trim./sem. → à planifier À LA MAIN (statut JAMAIS).
        const last = lastByKey.get(t.key)
          ?? (exigePremiereManuelle(t.frequence) ? null : dateReferenceTaches());
        const { statut, prochaine } = statutEcheance(last, FREQUENCE_MOIS[t.frequence], now);
        return {
          numero: t.numero,
          key: t.key,
          libelle: t.libelle,
          categorie: t.categorie,
          frequence: t.frequence,
          frequenceLabel: FREQUENCE_LABEL[t.frequence],
          derniereExecution: last,
          prochaineEcheance: prochaine,
          statut,
        };
      }),
    });
  } catch (err) { next(err); }
}

/**
 * Génère le planning préventif : crée une maintenance PLANIFIÉE pour chaque
 * couple site × tâche périodique applicable qui est dû (jamais faite, ou
 * dernière exécution + fréquence dépassée), sans doublon si un ticket est déjà ouvert.
 * Optionnel: ?horizonJours=N pour anticiper les échéances à venir.
 */
export async function genererPlanning(req: Request, res: Response, next: NextFunction) {
  try {
    const horizonJours = Math.max(0, Number(req.query.horizon_jours ?? 0) || 0);
    const result = await genererPlanningPreventif(horizonJours);
    await auditLog(req.user!.id, 'CREATE', 'maintenances', 'planning-preventif', { ...result, horizonJours }, req);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

/**
 * Échéancier de conformité préventive : pour chaque site actif × tâche applicable
 * périodique, statut (jamais / en retard / à jour). Filtres: prestataire_id, statut.
 */
export async function getEcheancier(req: Request, res: Response, next: NextFunction) {
  try {
    const { prestataire_id, statut: filtreStatut } = req.query as Record<string, string>;
    const now = new Date();

    // Périmètre prestataire : un superviseur prestataire ne voit l'échéancier
    // que des sites de ses lots (les internes voient tout le parc).
    const sites = await prisma.site.findMany({
      where: { isActive: true, ...(await sitePerimetre(req.user!.id)) },
      // Deux découpages : le lot passif porte les attributions passives, le
      // lot SOLAIRE (découpage distinct) porte l'attribution solaire — chaque
      // tâche est imputée au titulaire de SON contrat.
      include: {
        lot: { include: { assignments: { where: { scope: { in: SCOPES_PASSIFS } }, include: { prestataire: { select: { id: true, nom: true } } }, orderBy: { scope: 'asc' as const } } } },
        lotSolaire: { include: { assignments: { where: { scope: 'SOLAIRE' }, include: { prestataire: { select: { id: true, nom: true } } } } } },
      },
    });

    const done = await prisma.maintenance.groupBy({
      by: ['siteId', 'tachePreventiveKey'],
      where: { statut: 'TERMINEE', invalideeLe: null, tachePreventiveKey: { not: null } },
      _max: { dateFin: true },
    });
    const lastByKey = new Map<string, Date>();
    for (const d of done) if (d.tachePreventiveKey && d._max.dateFin) lastByKey.set(`${d.siteId}:${d.tachePreventiveKey}`, d._max.dateFin);

    const lignes: Array<Record<string, unknown>> = [];
    let aJour = 0, enRetard = 0, jamais = 0;
    const jetonsParc = await jetonsSuiviMoisCourant(sites.map((s) => s.id));

    for (const site of sites) {
      const prestaPassif = site.lot?.assignments?.[0]?.prestataire ?? null;
      const prestaSolaire = site.lotSolaire?.assignments?.[0]?.prestataire ?? null;
      for (const t of tachesPlanifiables(site as unknown as SiteEligibilite)) {
        const presta = t.categorie === 'SOLAIRE' ? prestaSolaire : prestaPassif;
        if (prestataire_id && presta?.id !== prestataire_id) continue;
        let last: Date | null;
        let statut: 'A_JOUR' | 'EN_RETARD' | 'JAMAIS';
        let prochaine: Date | null;
        if (t.suiviParDonnees) {
          // Suivi par les données : validé si relevé complet ou dépotage ce mois.
          last = null; prochaine = null;
          statut = suiviMoisValide(jetonsParc.get(site.id), site.powerConfig) ? 'A_JOUR' : 'EN_RETARD';
        } else {
          last = lastByKey.get(`${site.id}:${t.key}`)
            ?? (exigePremiereManuelle(t.frequence) ? null : dateReferenceTaches());
          ({ statut, prochaine } = statutEcheance(last, FREQUENCE_MOIS[t.frequence], now));
        }
        if (statut === 'A_JOUR') aJour++; else if (statut === 'EN_RETARD') enRetard++; else jamais++;
        if (filtreStatut && statut !== filtreStatut) continue;
        lignes.push({
          siteId: site.id, siteCode: site.code, siteNom: site.nom, region: site.region,
          prestataire: presta?.nom ?? null, prestataireId: presta?.id ?? null,
          tache: t.libelle, key: t.key, frequence: t.frequence, frequenceLabel: FREQUENCE_LABEL[t.frequence],
          derniereExecution: last, prochaineEcheance: prochaine, statut,
        });
      }
    }

    // En retard d'abord, puis jamais, puis à jour.
    const ordre: Record<StatutEcheance, number> = { EN_RETARD: 0, JAMAIS: 1, A_JOUR: 2 };
    lignes.sort((a, b) => ordre[a.statut as StatutEcheance] - ordre[b.statut as StatutEcheance]);

    res.json({ success: true, data: { resume: { aJour, enRetard, jamais, total: aJour + enRetard + jamais }, lignes } });
  } catch (err) { next(err); }
}

interface PrestaLite {
  id: string; nom: string; adresse: string | null; rccm: string | null; nif: string | null;
  contactCommercial: string | null; contactTechnique: string | null; logoPath: string | null;
}

function clientBlock(client?: string): { nom: string; adresse: string[] } {
  return {
    nom: client || process.env.CLIENT_NOM || 'Moov Africa Togo',
    adresse: (process.env.CLIENT_ADRESSE || 'Bld de la paix|BP 14511 LOME - TOGO').split('|'),
  };
}

/** Génère le buffer xlsx d'une fiche pour un prestataire (et un lot optionnel). */
async function produceFiche(presta: PrestaLite, lotId: string | null, an: number, mo: number, cb: { nom: string; adresse: string[] }, clientLogo: FicheLogo | null, contrat: 'PASSIF' | 'SOLAIRE' = 'PASSIF'): Promise<Buffer> {
  // Deux découpages de parc : la fiche PASSIVE suit les lots passifs (lot),
  // la fiche SOLAIRE suit les lots solaires (lotSolaire) — contrats séparés.
  const sites = await prisma.site.findMany({
    where: {
      isActive: true,
      ...(contrat === 'SOLAIRE'
        ? {
            lotSolaire: { assignments: { some: { prestataireId: presta.id, scope: 'SOLAIRE' } } },
            ...(lotId ? { lotSolaireId: lotId } : {}),
          }
        : {
            lot: { assignments: { some: { prestataireId: presta.id, scope: { in: SCOPES_PASSIFS } } } },
            ...(lotId ? { lotId } : {}),
          }),
    },
  });
  const monthStart = new Date(an, mo - 1, 1);
  const monthEnd = new Date(an, mo, 1);
  const done = await prisma.maintenance.findMany({
    where: {
      prestataireId: presta.id, statut: 'TERMINEE', invalideeLe: null, tachePreventiveKey: { not: null },
      dateFin: { gte: monthStart, lt: monthEnd },
      ...(lotId ? { site: contrat === 'SOLAIRE' ? { lotSolaireId: lotId } : { lotId } } : {}),
    },
    select: { siteId: true, tachePreventiveKey: true },
  });
  const byKey = new Map<string, Set<string>>();
  for (const m of done) {
    if (!m.tachePreventiveKey) continue;
    if (!byKey.has(m.tachePreventiveKey)) byKey.set(m.tachePreventiveKey, new Set());
    byKey.get(m.tachePreventiveKey)!.add(m.siteId);
  }
  const realisesParKey: Record<string, number> = {};
  for (const [k, set] of byKey) realisesParKey[k] = set.size;

  // Tâche « dépotage » : validée par les DONNÉES du mois de la fiche (une
  // livraison OU un relevé complet), pas par un ticket - sinon la ligne
  // resterait à zéro pour toujours.
  if (contrat !== 'SOLAIRE') {
    const ids = sites.map((x) => x.id);
    const [depsMois, relsMois] = await Promise.all([
      prisma.depotage.findMany({
        where: { siteId: { in: ids }, dateDepotage: { gte: monthStart, lt: monthEnd } },
        select: { siteId: true },
      }),
      prisma.releveEnergie.findMany({
        where: { siteId: { in: ids }, dateReleve: { gte: monthStart, lt: monthEnd }, source: { in: ['GE', 'CEET'] } },
        select: { siteId: true, source: true, volumeGasoilLitres: true },
      }),
    ]);
    const vusFiche = new Map<string, Set<string>>();
    const poserF = (id: string, tok: string) => (vusFiche.get(id) ?? vusFiche.set(id, new Set()).get(id)!).add(tok);
    for (const x of depsMois) poserF(x.siteId, 'LIV');
    for (const x of relsMois) {
      if (x.source === 'GE') { if (x.volumeGasoilLitres != null) poserF(x.siteId, 'GE'); }
      else poserF(x.siteId, 'CEET');
    }
    realisesParKey['depotage'] = sites.filter((x) =>
      TASK_BY_KEY['depotage'].eligible(x as unknown as SiteEligibilite)
      && suiviMoisValide(vusFiche.get(x.id), x.powerConfig)
    ).length;
  }

  let zone: string;
  if (lotId) {
    const lot = await prisma.lot.findUnique({ where: { id: lotId }, select: { nom: true, region: true } });
    zone = lot ? `${lot.nom}${lot.region ? ` (${lot.region})` : ''}` : '—';
  } else {
    zone = [...new Set(sites.map((s) => s.region))].join(', ') || '—';
  }
  const prestataireLogo = await loadLogo(presta.logoPath);
  return buildFicheValidationXlsx({
    prestataire: { nom: presta.nom, adresse: presta.adresse, rccm: presta.rccm, nif: presta.nif, contactCommercial: presta.contactCommercial, contactTechnique: presta.contactTechnique },
    client: cb,
    zone, nbSites: sites.length, annee: an, mois: mo,
    sites: sites as unknown as SiteEligibilite[], realisesParKey, prestataireLogo, clientLogo, contrat,
  });
}

/**
 * Fiche de validation mensuelle (xlsx) d'un prestataire (et lot optionnel) :
 * pour chaque tâche contractuelle, nb de sites concernés et nb réalisés dans le mois.
 */
export async function getFicheValidation(req: Request, res: Response, next: NextFunction) {
  try {
    const { prestataire_id, annee, mois, client, lot_id, contrat } = req.query as Record<string, string>;
    if (!prestataire_id) throw new AppError('Sélectionnez un prestataire.', 400);
    const an = parseInt(annee) || new Date().getFullYear();
    const mo = parseInt(mois);
    if (!(mo >= 1 && mo <= 12)) throw new AppError('Mois invalide (1-12).', 422);

    const presta = await prisma.prestataire.findUnique({ where: { id: prestataire_id } });
    if (!presta) throw new AppError('Prestataire introuvable.', 404);

    const typeContrat: 'PASSIF' | 'SOLAIRE' = contrat === 'SOLAIRE' ? 'SOLAIRE' : 'PASSIF';
    const clientLogo = await loadLogo(process.env.CLIENT_LOGO_KEY);
    const buf = await produceFiche(presta, lot_id || null, an, mo, clientBlock(client), clientLogo, typeContrat);

    const safeNom = presta.nom.replace(/[^a-z0-9]+/gi, '_');
    const suffixe = typeContrat === 'SOLAIRE' ? '-solaire' : '';
    setXlsxHeaders(res, `fiche-validation${suffixe}-${safeNom}-${String(mo).padStart(2, '0')}-${an}.xlsx`);
    res.send(buf);
  } catch (err) { next(err); }
}

/**
 * Génère TOUTES les fiches du mois (une par couple prestataire × lot passif),
 * renvoyées dans une archive ZIP.
 */
export async function getFichesBatch(req: Request, res: Response, next: NextFunction) {
  try {
    const { annee, mois, client } = req.query as Record<string, string>;
    const an = parseInt(annee) || new Date().getFullYear();
    const mo = parseInt(mois);
    if (!(mo >= 1 && mo <= 12)) throw new AppError('Mois invalide (1-12).', 422);

    const assignments = await prisma.lotAssignment.findMany({
      where: { scope: { in: [...SCOPES_PASSIFS, 'SOLAIRE'] }, prestataire: { isActive: true } },
      include: { prestataire: true, lot: { select: { id: true, code: true, contrat: true } } },
      orderBy: [{ prestataireId: 'asc' }, { lotId: 'asc' }],
    });

    const cb = clientBlock(client);
    const clientLogo = await loadLogo(process.env.CLIENT_LOGO_KEY);
    const zip = new JSZip();
    const seen = new Set<string>();
    let count = 0;
    for (const a of assignments) {
      const k = `${a.prestataireId}:${a.lotId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const solaire = a.lot.contrat === 'SOLAIRE';
      const buf = await produceFiche(a.prestataire, a.lotId, an, mo, cb, clientLogo, solaire ? 'SOLAIRE' : 'PASSIF');
      const safe = (s: string) => s.replace(/[^a-z0-9]+/gi, '_');
      zip.file(`${safe(a.prestataire.nom)}__${safe(a.lot.code)}${solaire ? '__SOLAIRE' : ''}.xlsx`, buf);
      count++;
    }
    if (count === 0) throw new AppError('Aucun couple prestataire/lot à exporter.', 404);

    const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="fiches-validation-${String(mo).padStart(2, '0')}-${an}.zip"`);
    res.send(zipBuf);
  } catch (err) { next(err); }
}

export { TASK_BY_KEY };
