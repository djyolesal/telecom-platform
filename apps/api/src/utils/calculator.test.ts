import { calculerStockSite, litresMoisGE } from './calculator';

describe('litresMoisGE (conso mensuelle d’un GE)', () => {
  it('permanent : kva × 0.75 × 720 × 0.25', () => {
    expect(litresMoisGE(100, 'GE_PERMANENT')).toBeCloseTo(13500, 5);
  });
  it('secours : kva × 0.65 × 240 × 0.25', () => {
    expect(litresMoisGE(100, 'GE_SECOURS')).toBeCloseTo(3900, 5);
  });
  it('0 si PAS_DE_GE ou puissance nulle', () => {
    expect(litresMoisGE(100, 'PAS_DE_GE')).toBe(0);
    expect(litresMoisGE(0, 'GE_PERMANENT')).toBe(0);
  });
  it('multi-GE : la somme reflète la puissance totale', () => {
    const deux = litresMoisGE(100, 'GE_PERMANENT') + litresMoisGE(100, 'GE_PERMANENT');
    expect(deux).toBeCloseTo(litresMoisGE(200, 'GE_PERMANENT'), 5);
  });
});

const site = (statutGE: string, puissanceGEkva: number) => ({ statutGE, puissanceGEkva });

describe('calculerStockSite', () => {
  it('GE permanent : conso mensuelle et autonomie', () => {
    const r = calculerStockSite(site('GE_PERMANENT', 100), { volumeGasoilLitres: 5000 });
    // 100 kVA × 0.75 × 720 h × 0.25 = 13 500 L/mois ; 450 L/jour ; 5000/450 ≈ 11.1 j
    expect(r.litresMois).toBe(13500);
    expect(r.autonomieJours).toBeCloseTo(11.1, 1);
    expect(r.niveauAlerte).toBe('OK');
  });

  it('GE secours : facteur 0.65 et 240 h/mois', () => {
    const r = calculerStockSite(site('GE_SECOURS', 100), { volumeGasoilLitres: 5000 });
    expect(r.litresMois).toBe(3900); // 100 × 0.65 × 240 × 0.25
  });

  it('PAS_DE_GE → niveau NA, pas d’autonomie', () => {
    const r = calculerStockSite(site('PAS_DE_GE', 0), { volumeGasoilLitres: 1000 });
    expect(r.niveauAlerte).toBe('NA');
    expect(r.autonomieJours).toBeNull();
    expect(r.litresMois).toBe(0);
  });

  it('puissance nulle → NA', () => {
    const r = calculerStockSite(site('GE_PERMANENT', 0), { volumeGasoilLitres: 1000 });
    expect(r.niveauAlerte).toBe('NA');
  });

  it('seuils d’alerte stock', () => {
    expect(calculerStockSite(site('GE_PERMANENT', 100), { volumeGasoilLitres: 0 }).niveauAlerte).toBe('VIDE');
    expect(calculerStockSite(site('GE_PERMANENT', 100), { volumeGasoilLitres: 200 }).niveauAlerte).toBe('CRITIQUE'); // ≤ 300
    expect(calculerStockSite(site('GE_PERMANENT', 100), { volumeGasoilLitres: 500 }).niveauAlerte).toBe('FAIBLE');   // ≤ 700
    expect(calculerStockSite(site('GE_PERMANENT', 100), { volumeGasoilLitres: 5000 }).niveauAlerte).toBe('OK');
  });

  it('relevé absent → stock 0, mais NON MESURÉ et surtout pas « cuve vide »', () => {
    // Le piège corrigé : un site jamais relevé affichait 0 L et « Cuve vide ».
    // L'outil affirmait une cuve vide là où il ne savait rien - ce qui gonflait
    // les sites en alerte et faisait diverger le total du bilan conso & stock,
    // lequel écarte justement les sites non mesurés.
    const r = calculerStockSite(site('GE_PERMANENT', 100), null);
    expect(r.stockLitres).toBe(0);
    expect(r.mesure).toBe(false);
    expect(r.niveauAlerte).toBe('NA');
  });

  it('cuve mesurée à 0 → VIDE : là, on sait', () => {
    const r = calculerStockSite(site('GE_PERMANENT', 100), { volumeGasoilLitres: 0 });
    expect(r.mesure).toBe(true);
    expect(r.niveauAlerte).toBe('VIDE');
  });

  it('puissance GE à 0 : la MESURE de la cuve est rendue telle quelle', () => {
    // Le niveau d'une cuve ne dépend pas de la puissance déclarée du groupe.
    // Une kVA manquante ramenait le stock affiché à 0 sur cet écran, alors que
    // le bilan montrait le vrai niveau - d'où deux chiffres pour un seul site.
    const r = calculerStockSite(site('GE_PERMANENT', 0), { volumeGasoilLitres: 1000 });
    expect(r.stockLitres).toBe(1000);
    expect(r.mesure).toBe(true);
    expect(r.niveauAlerte).toBe('NA');        // autonomie incalculable, elle
    expect(r.litresMois).toBe(0);             // la CONSO, oui, reste nulle
  });
});
