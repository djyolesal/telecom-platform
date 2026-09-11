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

  it("l'entretien pylône reste exclu sur TGC/LP-Greenfield", () => {
    expect(cles(site('TGC_GREENFIELD'))).not.toContain('entretien_pylone');
    expect(cles(site('LP_GREENFIELD'))).not.toContain('entretien_pylone');
    expect(cles(site('GREENFIELD'))).toContain('entretien_pylone');
  });
});
