/**
 * Rapprochement d'un fichier « sites → zone de maintenance → FME » avec le parc
 * et les contacts SMS. Logique PURE (aucun accès base) : le contrôleur charge,
 * cette fonction décide, l'écran affiche le plan avant toute écriture.
 *
 * Règle commune : un rapprochement douteux ne se devine pas. Un nom qui
 * désigne deux sites, ou deux contacts, est signalé et laissé de côté.
 */

/** Casse, accents et séparateurs ignorés : « Lomé-2 » = « LOME 2 ». */
export const normaliser = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Mots d'un nom de personne, sans ordre : « NOGLO Kokouvi » = « Kokouvi Noglo ». */
const motsPersonne = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean).sort().join(' ');

export interface LigneZone { ligne: number; site: string; zone: string; fme: string }
export interface SiteRef { id: string; nom: string; code: string; region: string; zoneId: string | null; isActive: boolean }
export interface ContactRef { id: string; nom: string; prenom: string; telephone: string; actif: boolean }
export interface ZoneRef { id: string; nom: string; responsableContactId: string | null }

export interface PlanZone {
  nom: string;
  existante: ZoneRef | null;
  fme: string;
  contact: ContactRef | null;
  /** Pourquoi le FME n'a pas été rattaché à un contact. */
  fmeProbleme: 'INTROUVABLE' | 'AMBIGU' | null;
  nbSites: number;
}

export interface PlanImport {
  zones: PlanZone[];
  affectations: Array<{ siteId: string; site: string; zone: string; avant: string | null }>;
  inchanges: number;
  sitesInconnus: Array<{ ligne: number; site: string; zone: string }>;
  sitesAmbigus: Array<{ ligne: number; site: string; candidats: string[] }>;
  /** Même site listé deux fois avec des zones différentes : on ne tranche pas. */
  contradictions: Array<{ site: string; zones: string[] }>;
  /** Sites actifs du parc absents du fichier : sans zone après l'import. */
  sitesAbsents: Array<{ id: string; nom: string; region: string; zoneActuelle: string | null }>;
}

/** Lit les lignes d'un tableau (en-têtes reconnus par synonymes). */
export function lireLignes(entetes: string[], lignes: Array<{ numero: number; cellules: string[] }>): LigneZone[] {
  const col = (noms: string[]) => entetes.findIndex((e) => noms.includes(normaliser(e)));
  const iSite = col(['sitename', 'site', 'nomsite', 'nom', 'sitenom']);
  const iZone = col(['actifmaintenancearea', 'maintenancearea', 'zone', 'zonemaintenance', 'zonedemaintenance', 'area']);
  const iFme = col(['fmename', 'fme', 'responsable', 'responsablezone']);
  if (iSite < 0 || iZone < 0) {
    throw new Error('Colonnes attendues : SITENAME (le site) et ACTIF MAINTENANCE AREA (la zone), FME NAME (le responsable) facultative.');
  }
  return lignes
    .map((l) => ({
      ligne: l.numero,
      site: (l.cellules[iSite] ?? '').trim(),
      zone: (l.cellules[iZone] ?? '').trim().replace(/\s+/g, ' '),
      fme: iFme >= 0 ? (l.cellules[iFme] ?? '').trim().replace(/\s+/g, ' ') : '',
    }))
    .filter((l) => l.site && l.zone);
}

export function planifierImport(
  lignes: LigneZone[],
  sites: SiteRef[],
  contacts: ContactRef[],
  zonesExistantes: ZoneRef[],
): PlanImport {
  // Index des sites par nom ET par code normalisés ; une clé à deux sites est ambiguë.
  const parCle = new Map<string, SiteRef[]>();
  const poser = (cle: string, s: SiteRef) => {
    if (!cle) return;
    const l = parCle.get(cle) ?? [];
    if (!l.includes(s)) l.push(s);
    parCle.set(cle, l);
  };
  for (const s of sites) { poser(normaliser(s.nom), s); poser(normaliser(s.code), s); }

  const zoneParCle = new Map(zonesExistantes.map((z) => [normaliser(z.nom), z]));
  const contactsActifs = contacts.filter((c) => c.actif);

  // Nom de zone tel qu'écrit la première fois dans le fichier, et ses FME cités.
  const zonesFichier = new Map<string, { nom: string; fmes: Map<string, number> }>();
  const zoneDuSite = new Map<string, { site: SiteRef; zones: Set<string>; ligne: number; texte: string }>();
  const sitesInconnus: PlanImport['sitesInconnus'] = [];
  const sitesAmbigus: PlanImport['sitesAmbigus'] = [];

  for (const l of lignes) {
    const cz = normaliser(l.zone);
    const z = zonesFichier.get(cz) ?? { nom: zoneParCle.get(cz)?.nom ?? l.zone, fmes: new Map() };
    if (l.fme) z.fmes.set(l.fme, (z.fmes.get(l.fme) ?? 0) + 1);
    zonesFichier.set(cz, z);

    const candidats = parCle.get(normaliser(l.site)) ?? [];
    if (candidats.length === 0) { sitesInconnus.push({ ligne: l.ligne, site: l.site, zone: l.zone }); continue; }
    if (candidats.length > 1) {
      sitesAmbigus.push({ ligne: l.ligne, site: l.site, candidats: candidats.map((c) => c.nom) });
      continue;
    }
    const s = candidats[0];
    const e = zoneDuSite.get(s.id) ?? { site: s, zones: new Set<string>(), ligne: l.ligne, texte: l.site };
    e.zones.add(cz);
    zoneDuSite.set(s.id, e);
  }

  const contradictions: PlanImport['contradictions'] = [];
  const affectations: PlanImport['affectations'] = [];
  const nomZoneId = new Map(zonesExistantes.map((z) => [z.id, z.nom]));
  let inchanges = 0;
  const nbParZone = new Map<string, number>();
  for (const { site, zones } of zoneDuSite.values()) {
    if (zones.size > 1) {
      contradictions.push({ site: site.nom, zones: [...zones].map((c) => zonesFichier.get(c)!.nom) });
      continue;
    }
    const cz = [...zones][0];
    nbParZone.set(cz, (nbParZone.get(cz) ?? 0) + 1);
    const zoneNom = zonesFichier.get(cz)!.nom;
    const avant = site.zoneId ? nomZoneId.get(site.zoneId) ?? null : null;
    if (avant && normaliser(avant) === cz) { inchanges++; continue; }
    affectations.push({ siteId: site.id, site: site.nom, zone: zoneNom, avant });
  }

  const zones: PlanZone[] = [...zonesFichier.entries()].map(([cz, z]) => {
    // Le FME le plus cité pour la zone (un fichier propre n'en a qu'un).
    const fme = [...z.fmes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    let contact: ContactRef | null = null;
    let fmeProbleme: PlanZone['fmeProbleme'] = null;
    if (fme) {
      const cible = motsPersonne(fme);
      const trouves = contactsActifs.filter((c) =>
        motsPersonne(`${c.nom} ${c.prenom}`) === cible);
      if (trouves.length === 1) contact = trouves[0];
      else fmeProbleme = trouves.length ? 'AMBIGU' : 'INTROUVABLE';
    }
    return { nom: z.nom, existante: zoneParCle.get(cz) ?? null, fme, contact, fmeProbleme, nbSites: nbParZone.get(cz) ?? 0 };
  }).sort((a, b) => a.nom.localeCompare(b.nom));

  const vus = new Set(zoneDuSite.keys());
  const sitesAbsents = sites
    .filter((s) => s.isActive && !vus.has(s.id))
    .map((s) => ({ id: s.id, nom: s.nom, region: s.region, zoneActuelle: s.zoneId ? nomZoneId.get(s.zoneId) ?? null : null }))
    .sort((a, b) => a.region.localeCompare(b.region) || a.nom.localeCompare(b.nom));

  return {
    zones, affectations, inchanges,
    sitesInconnus, sitesAmbigus, contradictions, sitesAbsents,
  };
}
