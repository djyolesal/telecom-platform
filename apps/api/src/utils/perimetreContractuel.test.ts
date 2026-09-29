import {
  estDue, estExclue, tachesForSite, tachesPlanifiables,
  TASK_BY_KEY, SiteEligibilite, ExclusionPerimetre,
} from './tachesPreventives';

const d = (iso: string) => new Date(iso);

/** Centre technique type : CEET + GE de secours, avec cuve et climatiseur. */
const centreTechnique = (exclusions: ExclusionPerimetre[] = []): SiteEligibilite => ({
  typePylone: null,
  hasClimatiseur: true,
  hasExtincteurs: true,
  powerConfig: 'CEET_GE',
  statutGE: 'GE_SECOURS',
  cuveVolumeLitres: 2000,
  exclusions,
});

const GE_HORS_CONTRAT: ExclusionPerimetre[] = [
  { tacheKey: 'ge_secours', debut: d('2026-10-01'), fin: null },
  { tacheKey: 'curage_cuve', debut: d('2026-10-01'), fin: null },
];

describe('périmètre contractuel - l’éligibilité technique ne suffit pas', () => {
  it('sans exclusion, rien ne change : le dû est celui d’avant', () => {
    const cles = tachesPlanifiables(centreTechnique(), d('2026-11-15')).map((t) => t.key);
    expect(cles).toContain('ge_secours');
    expect(cles).toContain('curage_cuve');
    expect(cles).toContain('desherbage');
  });

  it('un site dont le GE est hors contrat garde ses autres tâches', () => {
    const cles = tachesForSite(centreTechnique(GE_HORS_CONTRAT), d('2026-11-15')).map((t) => t.key);
    // Le GE sort…
    expect(cles).not.toContain('ge_secours');
    expect(cles).not.toContain('curage_cuve');
    // …mais le site reste dû sur tout le reste. Ce n'est pas le SITE qui sort
    // du contrat, c'est une famille de tâches sur ce site.
    expect(cles).toContain('desherbage');
    expect(cles).toContain('extincteurs');
    expect(cles).toContain('clim');
    expect(cles).toContain('tgbt_avr_onduleur');
  });

  it('l’éligibilité TECHNIQUE reste vraie : on n’a pas menti sur l’équipement', () => {
    // Le site a bien un GE de secours. Le catalogue doit continuer à le dire -
    // c'est le périmètre qui l'exclut, pas l'absence de matériel.
    const s = centreTechnique(GE_HORS_CONTRAT);
    expect(TASK_BY_KEY['ge_secours'].eligible(s)).toBe(true);
    expect(estDue(TASK_BY_KEY['ge_secours'], s, d('2026-11-15'))).toBe(false);
  });
});

describe('périmètre contractuel - la date protège les mois signés', () => {
  const s = centreTechnique(GE_HORS_CONTRAT);

  it('avant la prise d’effet, la tâche reste due', () => {
    // Septembre 2026 : la fiche est signée, elle comptait ce site. Elle doit
    // continuer à le compter si on la régénère.
    expect(estDue(TASK_BY_KEY['ge_secours'], s, d('2026-09-30'))).toBe(true);
  });

  it('à partir de la prise d’effet, elle ne l’est plus', () => {
    expect(estDue(TASK_BY_KEY['ge_secours'], s, d('2026-10-01'))).toBe(false);
    expect(estDue(TASK_BY_KEY['ge_secours'], s, d('2027-03-01'))).toBe(false);
  });

  it('une exclusion CLOSE ne vaut que sur sa période', () => {
    const temporaire = centreTechnique([
      { tacheKey: 'clim', debut: d('2026-03-01'), fin: d('2026-06-30') },
    ]);
    expect(estDue(TASK_BY_KEY['clim'], temporaire, d('2026-02-28'))).toBe(true);
    expect(estDue(TASK_BY_KEY['clim'], temporaire, d('2026-04-15'))).toBe(false);
    expect(estDue(TASK_BY_KEY['clim'], temporaire, d('2026-06-30'))).toBe(false); // dernier jour inclus
    expect(estDue(TASK_BY_KEY['clim'], temporaire, d('2026-07-01'))).toBe(true);
  });
});

describe('périmètre contractuel - garde-fous', () => {
  it('exclusions non chargées = dû COMPLET, jamais un dû amputé en silence', () => {
    // Un appelant qui oublie de charger les exclusions doit obtenir le
    // comportement d'avant. L'inverse ferait disparaître des dûs sans trace.
    const sansChamp = { ...centreTechnique() };
    delete (sansChamp as { exclusions?: unknown }).exclusions;
    expect(estDue(TASK_BY_KEY['ge_secours'], sansChamp, d('2026-11-15'))).toBe(true);
    expect(estExclue(sansChamp, 'ge_secours', d('2026-11-15'))).toBe(false);
  });

  it('une exclusion ne rend pas due une tâche techniquement inapplicable', () => {
    const sansClim = { ...centreTechnique(), hasClimatiseur: false };
    expect(estDue(TASK_BY_KEY['clim'], sansClim, d('2026-11-15'))).toBe(false);
  });

  it('une clé inconnue au catalogue n’a aucun effet de bord', () => {
    const s = centreTechnique([{ tacheKey: 'tache_disparue', debut: d('2026-01-01'), fin: null }]);
    expect(tachesForSite(s, d('2026-11-15')).length).toBe(tachesForSite(centreTechnique(), d('2026-11-15')).length);
  });
});
