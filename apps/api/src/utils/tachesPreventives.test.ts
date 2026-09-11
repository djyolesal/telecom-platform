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
  it('désherbage exclu sur TOUT site sur toit, y compris les variantes admin', () => {
    // Le référentiel des types de pylône est éditable : la règle doit couvrir
    // les codes ajoutés après coup, pas seulement le ROOFTOP semé.
    for (const t of ['ROOFTOP', 'ROOF_TOP', 'SUR_TOIT', 'TERRASSE', 'TOITURE_3']) {
      expect(cles(site(t))).not.toContain('desherbage');
    }
  });

  it('désherbage dû sur les sites au sol (et sans type renseigné)', () => {
    for (const t of ['GREENFIELD', 'RURAL', 'TROTTOIR', null]) {
      expect(cles(site(t))).toContain('desherbage');
    }
  });

  it("l'entretien pylône reste exclu sur TGC/LP-Greenfield", () => {
    expect(cles(site('TGC_GREENFIELD'))).not.toContain('entretien_pylone');
    expect(cles(site('LP_GREENFIELD'))).not.toContain('entretien_pylone');
    expect(cles(site('GREENFIELD'))).toContain('entretien_pylone');
  });
});
