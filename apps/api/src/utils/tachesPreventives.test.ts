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

  it('GE secours (connecté CEET) réservé aux configurations CEET + GE', () => {
    const avec = (powerConfig: string, statutGE: string): SiteEligibilite => ({ ...site('GREENFIELD'), powerConfig, statutGE });
    expect(cles(avec('CEET_GE', 'GE_SECOURS'))).toContain('ge_secours');
    expect(cles(avec('HYBRIDE_CEET_GE', 'GE_SECOURS'))).toContain('ge_secours');
    // La configuration prime sur le champ statutGE (déclaratif) : un site
    // GE-permanent ou hybride sans CEET n'a pas de GE « de secours ».
    expect(cles(avec('GE_UNIQUEMENT', 'GE_SECOURS'))).not.toContain('ge_secours');
    expect(cles(avec('HYBRIDE_GE', 'GE_SECOURS'))).not.toContain('ge_secours');
    expect(cles(avec('CEET_UNIQUEMENT', 'PAS_DE_GE'))).not.toContain('ge_secours');
    // Et l'entretien GE de production reste sur ses configurations à lui.
    expect(cles(avec('GE_UNIQUEMENT', 'GE_PERMANENT'))).toContain('ge_production');
    expect(cles(avec('CEET_GE', 'GE_SECOURS'))).not.toContain('ge_production');
  });

  it("l'entretien pylône reste exclu sur TGC/LP-Greenfield", () => {
    expect(cles(site('TGC_GREENFIELD'))).not.toContain('entretien_pylone');
    expect(cles(site('LP_GREENFIELD'))).not.toContain('entretien_pylone');
    expect(cles(site('GREENFIELD'))).toContain('entretien_pylone');
  });
});
