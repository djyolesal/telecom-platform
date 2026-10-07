import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { ConfigCuve, SourceCuve, litresPourHauteur, resoudreConfigCuve } from '../utils/cuve';

/**
 * Configuration de conversion de la cuve d'un site : la sienne (dimensions
 * internes, barème propre) et celle de son MODÈLE de cuve, départagées par
 * `resoudreConfigCuve`. Tout ce qui convertit une hauteur en litres côté
 * serveur passe par ici - relevés, clôtures, dépotages, contexte mobile.
 */

const POINTS = { orderBy: { hauteurCm: 'asc' }, select: { hauteurCm: true, litres: true } } as const;

export const SELECT_MODELE_CUVE = {
  id: true, nom: true, capaciteLitres: true, formeCuve: true,
  longueurCm: true, largeurCm: true, hauteurCm: true, diametreCm: true,
  baremage: POINTS,
} satisfies Prisma.ModeleCuveSelect;

export const SELECT_CUVE_SITE = {
  formeCuve: true, cuveLongueurCm: true, cuveLargeurCm: true,
  cuveHauteurCm: true, cuveDiametreCm: true,
  baremage: POINTS,
  modeleCuve: { select: SELECT_MODELE_CUVE },
} satisfies Prisma.SiteSelect;

type Dec = Prisma.Decimal | number | null;
type Points = { hauteurCm: Dec; litres: Dec }[];
type ModeleCuveLu = Prisma.ModeleCuveGetPayload<{ select: typeof SELECT_MODELE_CUVE }>;
type CuvePropre = {
  formeCuve: ConfigCuve['formeCuve'];
  cuveLongueurCm: Dec; cuveLargeurCm: Dec; cuveHauteurCm: Dec; cuveDiametreCm: Dec;
  baremage: Points;
};

const n = (v: Dec | undefined) => (v != null ? Number(v) : null);
const points = (b: Points) => b.map((p) => ({ hauteurCm: Number(p.hauteurCm), litres: Number(p.litres) }));

/** Configuration PROPRE au site, telle que stockée sur sa fiche. */
export function configPropre(s: CuvePropre): ConfigCuve {
  return {
    formeCuve: s.formeCuve,
    cuveLongueurCm: n(s.cuveLongueurCm),
    cuveLargeurCm: n(s.cuveLargeurCm),
    cuveHauteurCm: n(s.cuveHauteurCm),
    cuveDiametreCm: n(s.cuveDiametreCm),
    baremage: points(s.baremage),
  };
}

/** Configuration d'un modèle de cuve, dans le vocabulaire du moteur de conversion. */
export function configModele(m: Omit<ModeleCuveLu, 'id' | 'nom' | 'capaciteLitres'>): ConfigCuve {
  return {
    formeCuve: m.formeCuve,
    cuveLongueurCm: n(m.longueurCm),
    cuveLargeurCm: n(m.largeurCm),
    cuveHauteurCm: n(m.hauteurCm),
    cuveDiametreCm: n(m.diametreCm),
    baremage: points(m.baremage),
  };
}

export interface CuveEffective {
  config: ConfigCuve;
  source: SourceCuve | null;
  modele: { id: string; nom: string; capaciteLitres: number } | null;
}

/** Conversion qui fait foi pour un site lu avec SELECT_CUVE_SITE. */
export function cuveEffective(s: CuvePropre & { modeleCuve: ModeleCuveLu | null }): CuveEffective {
  const m = s.modeleCuve;
  const r = resoudreConfigCuve(configPropre(s), m ? configModele(m) : null);
  return { ...r, modele: m ? { id: m.id, nom: m.nom, capaciteLitres: Number(m.capaciteLitres) } : null };
}

/**
 * Charge la conversion qui fait foi pour la cuve d'un site. À passer ensuite à
 * litresPourHauteur - une seule lecture même pour plusieurs conversions
 * (dépotage : avant ET après).
 */
export async function configCuveDuSite(siteId: string): Promise<ConfigCuve> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: SELECT_CUVE_SITE });
  if (!site) return {};
  return cuveEffective(site).config;
}

/**
 * Tous les modèles de cuve, en configurations de conversion indexées par id :
 * pour les traitements de masse, qui liraient sinon le même barème une fois
 * par site.
 */
export async function configsModeles(): Promise<Map<string, ConfigCuve>> {
  const modeles = await prisma.modeleCuve.findMany({ select: SELECT_MODELE_CUVE });
  return new Map(modeles.map((m) => [m.id, configModele(m)]));
}

export { litresPourHauteur };
