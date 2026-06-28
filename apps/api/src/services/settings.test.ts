import { getNum, geParams, settingsCatalog, effectiveSettings } from './settings.service';

// Cache vide en test (loadSettings non appelé) → tout retombe sur les défauts.
describe('settings overlay (sans surcharge BDD)', () => {
  it('getNum renvoie le repli quand la clé est absente', () => {
    expect(getNum('clef.inexistante', 42)).toBe(42);
  });

  it('geParams renvoie les constantes GE par défaut', () => {
    const p = geParams();
    expect(p.seuilCritiqueLitres).toBe(300);
    expect(p.seuilFaibleLitres).toBe(700);
    expect(p.prixLitreFCFA).toBe(850);
  });

  it('le catalogue expose des défauts numériques', () => {
    const cat = settingsCatalog();
    expect(cat.length).toBeGreaterThan(8);
    for (const s of cat) {
      expect(typeof s.defaut).toBe('number');
      expect(Number.isFinite(s.defaut)).toBe(true);
      expect(s.key).toMatch(/\./); // clés "groupe.param"
    }
  });

  it('effectiveSettings = défaut quand rien en base', () => {
    const eff = effectiveSettings();
    for (const s of eff) expect(s.valeur).toBe(s.defaut);
  });
});
