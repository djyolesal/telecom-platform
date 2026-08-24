import { litresPourHauteur, volumeMaxLitres, hauteurMaxCm, cuveCalculable, ConfigCuve } from './cuve';

describe('conversion hauteur → litres', () => {
  describe('cuve rectangulaire (linéaire)', () => {
    const cfg: ConfigCuve = { formeCuve: 'RECTANGULAIRE', cuveLongueurCm: 200, cuveLargeurCm: 100, cuveHauteurCm: 100 };

    it('proportionnelle à la hauteur', () => {
      expect(litresPourHauteur(cfg, 0)).toBe(0);
      expect(litresPourHauteur(cfg, 50)).toBe(1000); // 200×100×50 cm³ = 1000 L
      expect(litresPourHauteur(cfg, 100)).toBe(2000);
    });

    it('borne à la hauteur de cuve', () => {
      expect(litresPourHauteur(cfg, 150)).toBe(2000);
      expect(hauteurMaxCm(cfg)).toBe(100);
      expect(volumeMaxLitres(cfg)).toBe(2000);
    });
  });

  describe('cylindre couché (segment circulaire, non linéaire)', () => {
    // d=100, L=255 → volume plein = π·50²·255/1000 ≈ 2002.8 L
    const cfg: ConfigCuve = { formeCuve: 'CYLINDRE_COUCHE', cuveDiametreCm: 100, cuveLongueurCm: 255 };

    it('vide, mi-hauteur = mi-volume (symétrie), plein', () => {
      expect(litresPourHauteur(cfg, 0)).toBe(0);
      const plein = litresPourHauteur(cfg, 100)!;
      expect(plein).toBeCloseTo(2002.8, 0);
      expect(litresPourHauteur(cfg, 50)).toBeCloseTo(plein / 2, 0);
    });

    it('NON linéaire : un quart de hauteur < un quart de volume', () => {
      const plein = litresPourHauteur(cfg, 100)!;
      const quartHauteur = litresPourHauteur(cfg, 25)!;
      expect(quartHauteur).toBeLessThan(plein / 4);
      // Valeur exacte du segment : r²(acos(½) − …) → ≈ 19.55 % du plein.
      expect(quartHauteur / plein).toBeCloseTo(0.1955, 2);
    });

    it('borne au diamètre', () => {
      expect(litresPourHauteur(cfg, 130)).toBe(litresPourHauteur(cfg, 100));
      expect(hauteurMaxCm(cfg)).toBe(100);
    });
  });

  describe('table de barémage (prioritaire)', () => {
    const cfg: ConfigCuve = {
      formeCuve: 'CYLINDRE_COUCHE', cuveDiametreCm: 100, cuveLongueurCm: 255, // ignoré : barème présent
      baremage: [
        { hauteurCm: 20, litres: 300 },
        { hauteurCm: 60, litres: 1100 },
        { hauteurCm: 100, litres: 1900 },
      ],
    };

    it('interpole entre les points', () => {
      expect(litresPourHauteur(cfg, 20)).toBe(300);
      expect(litresPourHauteur(cfg, 40)).toBe(700); // milieu de [20,60]
      expect(litresPourHauteur(cfg, 100)).toBe(1900);
    });

    it('sous le premier point : proportionnel depuis (0,0) ; au-delà : borné', () => {
      expect(litresPourHauteur(cfg, 10)).toBe(150);
      expect(litresPourHauteur(cfg, 120)).toBe(1900);
      expect(volumeMaxLitres(cfg)).toBe(1900);
    });

    it('un seul point = barème inutilisable → retombe sur la géométrie', () => {
      const unPoint: ConfigCuve = { ...cfg, baremage: [{ hauteurCm: 100, litres: 1900 }] };
      expect(litresPourHauteur(unPoint, 100)).toBeCloseTo(2002.8, 0);
    });
  });

  describe('cuve non configurée', () => {
    it('null tant que la config est incomplète', () => {
      expect(litresPourHauteur({}, 50)).toBeNull();
      expect(litresPourHauteur({ formeCuve: 'RECTANGULAIRE', cuveLongueurCm: 200 }, 50)).toBeNull();
      expect(litresPourHauteur({ formeCuve: 'CYLINDRE_COUCHE', cuveDiametreCm: 100 }, 50)).toBeNull();
      expect(cuveCalculable({})).toBe(false);
      expect(cuveCalculable({ formeCuve: 'RECTANGULAIRE', cuveLongueurCm: 200, cuveLargeurCm: 100, cuveHauteurCm: 100 })).toBe(true);
    });

    it('hauteur invalide → null', () => {
      const cfg: ConfigCuve = { formeCuve: 'RECTANGULAIRE', cuveLongueurCm: 200, cuveLargeurCm: 100, cuveHauteurCm: 100 };
      expect(litresPourHauteur(cfg, -5)).toBeNull();
      expect(litresPourHauteur(cfg, NaN)).toBeNull();
    });
  });
});
