import { tachesPlanifiables, SiteEligibilite } from './tachesPreventives';

const site = (typePylone: string | null): SiteEligibilite => ({
  typePylone,
  hasClimatiseur: false,
  hasExtincteurs: false,
  powerConfig: 'HYBRIDE_GE',
  statutGE: 'GE_PERMANENT',
  cuveVolumeLitres: null,
});

const cles = (s: SiteEligibilite) => tachesPlanifiables(s).map((t) => t.key);

describe('tachesPreventives - éligibilité par type de site', () => {
  it('désherbage/nettoyage dû sur TOUS les sites, rooftop compris (décision exploitant 11/09/2026)', () => {
    for (const t of ['ROOFTOP', 'ROOF_TOP', 'TERRASSE', 'GREENFIELD', 'RURAL', 'TROTTOIR', null]) {
      expect(cles(site(t))).toContain('desherbage');
    }
  });

  it('GE de secours : sites CEET + GE, et hybrides avec GE', () => {
    const avec = (powerConfig: string, statutGE: string): SiteEligibilite => ({ ...site('GREENFIELD'), powerConfig, statutGE });
    expect(cles(avec('CEET_GE', 'GE_SECOURS'))).toContain('ge_secours');
    expect(cles(avec('HYBRIDE_CEET_GE', 'GE_SECOURS'))).toContain('ge_secours');
    // La configuration prime sur le champ statutGE (déclaratif) : un site dont
    // le GE EST la source d'énergie n'a pas de GE « de secours », quoi que
    // dise statutGE.
    expect(cles(avec('GE_UNIQUEMENT', 'GE_SECOURS'))).not.toContain('ge_secours');
    expect(cles(avec('CEET_UNIQUEMENT', 'PAS_DE_GE'))).not.toContain('ge_secours');
  });

  // DÉCISION EXPLOITANT 01/10/2026. Ce qui sépare les lignes 9 et 10 de la
  // fiche est le RÉGIME du groupe, pas la présence du réseau public : sur un
  // hybride, le solaire produit et le GE ne démarre qu'en relève. Le compter
  // « en production » le facturait et l'usait sur le mauvais régime. Un
  // hybride ne doit JAMAIS retomber sur les deux lignes à la fois.
  it('hybride solaire + GE : le groupe compte comme GE de secours, pas de production', () => {
    const hybride = { ...site('GREENFIELD'), powerConfig: 'HYBRIDE_GE', statutGE: 'GE_SECOURS' };
    expect(cles(hybride)).toContain('ge_secours');
    expect(cles(hybride)).not.toContain('ge_production');
    // Même chose si la fiche du site le déclare encore « permanent ».
    const declarePermanent = { ...hybride, statutGE: 'GE_PERMANENT' };
    expect(cles(declarePermanent)).toContain('ge_secours');
    expect(cles(declarePermanent)).not.toContain('ge_production');
  });

  it('GE de production : réservé aux sites dont le GE est la source d’énergie', () => {
    const avec = (powerConfig: string, statutGE: string): SiteEligibilite => ({ ...site('GREENFIELD'), powerConfig, statutGE });
    expect(cles(avec('GE_UNIQUEMENT', 'GE_PERMANENT'))).toContain('ge_production');
    expect(cles(avec('CEET_GE', 'GE_SECOURS'))).not.toContain('ge_production');
    expect(cles(avec('HYBRIDE_CEET_GE', 'GE_SECOURS'))).not.toContain('ge_production');
  });

  it("l'entretien pylône reste exclu sur TGC/LP-Greenfield", () => {
    expect(cles(site('TGC_GREENFIELD'))).not.toContain('entretien_pylone');
    expect(cles(site('LP_GREENFIELD'))).not.toContain('entretien_pylone');
    expect(cles(site('GREENFIELD'))).toContain('entretien_pylone');
  });
});
