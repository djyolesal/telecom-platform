import { lireLignes, planifierImport, normaliser, SiteRef, ContactRef } from './zonesImport';

/** Import des zones de maintenance : rapprochement fichier ↔ parc ↔ contacts SMS. */

const site = (id: string, nom: string, zoneId: string | null = null, code = `C-${id}`): SiteRef =>
  ({ id, nom, code, region: 'Maritime', zoneId, isActive: true });
const contact = (id: string, nom: string, prenom: string, actif = true): ContactRef =>
  ({ id, nom, prenom, telephone: `9000000${id}`, actif });

describe('lecture du fichier', () => {
  it('reconnaît les en-têtes du fichier Moov et ignore les lignes vides', () => {
    const l = lireLignes(['SITENAME', 'ACTIF MAINTENANCE AREA', 'FME NAME'], [
      { numero: 2, cellules: ['4PORT', 'LOME 1', 'NOGLO  Kokouvi'] },
      { numero: 3, cellules: ['', '', ''] },
    ]);
    expect(l).toEqual([{ ligne: 2, site: '4PORT', zone: 'LOME 1', fme: 'NOGLO Kokouvi' }]);
  });

  it('refuse un fichier sans colonne site ou zone', () => {
    expect(() => lireLignes(['NOM', 'REGION'], [])).toThrow(/ACTIF MAINTENANCE AREA/);
  });
});

describe('plan d\'import', () => {
  const sites = [site('s1', 'ABOBO'), site('s2', 'Agoè-Nyivé'), site('s3', 'KARA 1', 'z1'), site('s4', 'DOUBLON'), site('s5', 'doublon'), site('s6', 'SANS ZONE')];
  const contacts = [contact('1', 'NOGLO', 'Kokouvi'), contact('2', 'AGBONEGBAN', 'Kokouvi'), contact('3', 'AGBONEGBAN', 'Kokouvi', false)];
  const plan = planifierImport(
    lireLignes(['SITENAME', 'ACTIF MAINTENANCE AREA', 'FME NAME'], [
      { numero: 2, cellules: ['abobo', 'LOME 1', 'NOGLO Kokouvi'] },
      { numero: 3, cellules: ['AGOE NYIVE', 'LOME 2', 'Kokouvi AGBONEGBAN'] },
      { numero: 4, cellules: ['KARA-1', 'KARA', 'INCONNU Jean'] },
      { numero: 5, cellules: ['FANTOME', 'LOME 1', 'NOGLO Kokouvi'] },
      { numero: 6, cellules: ['DOUBLON', 'LOME 1', 'NOGLO Kokouvi'] },
    ].map((l) => l)),
    sites, contacts, [{ id: 'z1', nom: 'Kara', responsableContactId: null }],
  );

  it('rattache les sites malgré casse, accents et tirets', () => {
    expect(plan.affectations.map((a) => [a.site, a.zone])).toEqual([['ABOBO', 'LOME 1'], ['Agoè-Nyivé', 'LOME 2']]);
  });

  it('un site déjà dans la bonne zone (nom de zone écrit autrement) est inchangé', () => {
    expect(plan.inchanges).toBe(1);
    expect(plan.zones.find((z) => normaliser(z.nom) === 'kara')!.existante?.id).toBe('z1');
  });

  it('FME retrouvé quel que soit l\'ordre nom/prénom, contacts inactifs ignorés', () => {
    const z = (n: string) => plan.zones.find((x) => x.nom === n)!;
    expect(z('LOME 1').contact?.id).toBe('1');
    expect(z('LOME 2').contact?.id).toBe('2');
    expect(z('Kara').fmeProbleme).toBe('INTROUVABLE');
  });

  it('signale sans deviner : site inconnu, site ambigu, site du parc absent du fichier', () => {
    expect(plan.sitesInconnus.map((s) => s.site)).toEqual(['FANTOME']);
    expect(plan.sitesAmbigus[0].candidats.sort()).toEqual(['DOUBLON', 'doublon']);
    expect(plan.sitesAbsents.map((s) => s.nom)).toEqual(expect.arrayContaining(['SANS ZONE', 'DOUBLON', 'doublon']));
  });

  it('un même site dans deux zones : contradiction, pas d\'affectation', () => {
    const p = planifierImport([
      { ligne: 2, site: 'ABOBO', zone: 'LOME 1', fme: '' },
      { ligne: 3, site: 'abobo', zone: 'LOME 3', fme: '' },
    ], sites, contacts, []);
    expect(p.contradictions).toEqual([{ site: 'ABOBO', zones: ['LOME 1', 'LOME 3'] }]);
    expect(p.affectations).toHaveLength(0);
  });

  it('deux contacts actifs au même nom : FME ambigu, non rattaché', () => {
    const p = planifierImport([{ ligne: 2, site: 'ABOBO', zone: 'LOME 1', fme: 'NOGLO Kokouvi' }], sites,
      [...contacts, contact('9', 'Noglo', 'Kokouvi')], []);
    expect(p.zones[0].fmeProbleme).toBe('AMBIGU');
    expect(p.zones[0].contact).toBeNull();
  });
});
