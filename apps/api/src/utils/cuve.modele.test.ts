import fs from 'fs';
import path from 'path';
import { ConfigCuve, litresPourHauteur, resoudreConfigCuve, volumeMaxLitres } from './cuve';
import { validerPointsBareme } from './baremeSaisi';

/**
 * Modèles de cuve : quelle conversion fait foi pour un site, et les barèmes
 * livrés par la migration 0073 sont-ils dans la bonne unité ?
 */

const BAREME_SITE: ConfigCuve = { baremage: [{ hauteurCm: 0, litres: 0 }, { hauteurCm: 100, litres: 1000 }] };
const DIMS_SITE: ConfigCuve = { formeCuve: 'RECTANGULAIRE', cuveLongueurCm: 100, cuveLargeurCm: 100, cuveHauteurCm: 100 };
const MODELE: ConfigCuve = { baremage: [{ hauteurCm: 0, litres: 0 }, { hauteurCm: 150, litres: 3000 }] };
const MODELE_SANS_CONVERSION: ConfigCuve = { formeCuve: 'CYLINDRE_COUCHE' };

describe('conversion qui fait foi pour un site', () => {
  it('le barème PROPRE au site passe devant le modèle (le cas particulier)', () => {
    const r = resoudreConfigCuve(BAREME_SITE, MODELE);
    expect(r.source).toBe('BAREME_SITE');
    expect(litresPourHauteur(r.config, 50)).toBe(500);
  });

  it('le modèle passe devant des dimensions prises au mètre ruban', () => {
    const r = resoudreConfigCuve(DIMS_SITE, MODELE);
    expect(r.source).toBe('MODELE');
    expect(litresPourHauteur(r.config, 75)).toBe(1500);
  });

  it("un modèle non calculable (2000 L simple sans dimensions) ne masque pas les dimensions du site", () => {
    expect(resoudreConfigCuve(DIMS_SITE, MODELE_SANS_CONVERSION).source).toBe('DIMENSIONS_SITE');
  });

  it('sans rien de calculable : pas de conversion', () => {
    expect(resoudreConfigCuve({}, MODELE_SANS_CONVERSION).source).toBeNull();
    expect(resoudreConfigCuve({}, null).source).toBeNull();
  });
});

describe('barème saisi', () => {
  it('trie, arrondit au dixième et accepte 0 point (effacement)', () => {
    expect(validerPointsBareme([{ hauteurCm: 2.04, litres: 20 }, { hauteurCm: 1, litres: 10 }]))
      .toEqual([{ hauteurCm: 1, litres: 10 }, { hauteurCm: 2, litres: 20 }]);
    expect(validerPointsBareme([])).toEqual([]);
  });

  it('refuse un barème non monotone, un doublon, un point seul, une valeur illisible', () => {
    expect(() => validerPointsBareme([{ hauteurCm: 1, litres: 10 }, { hauteurCm: 2, litres: 5 }])).toThrow(/décroissants/);
    expect(() => validerPointsBareme([{ hauteurCm: 1, litres: 10 }, { hauteurCm: 1, litres: 12 }])).toThrow(/même hauteur/);
    expect(() => validerPointsBareme([{ hauteurCm: 1, litres: 10 }])).toThrow(/au moins 2 points/);
    expect(() => validerPointsBareme([{ hauteurCm: 1, litres: '939+' }, { hauteurCm: 2, litres: 20 }])).toThrow(/Point n°1/);
  });
});

/** Barèmes insérés par la migration 0073, relus dans le SQL. */
function baremesMigration(): Map<string, { capacite: number; points: { hauteurCm: number; litres: number }[] }> {
  const sql = fs.readFileSync(path.join(__dirname, '../../prisma/migrations/0073_modeles_cuve/migration.sql'), 'utf8');
  const out = new Map<string, { capacite: number; points: { hauteurCm: number; litres: number }[] }>();
  for (const m of sql.matchAll(/VALUES \(gen_random_uuid\(\)::text, '([^']+)', (\d+),/g)) out.set(m[1], { capacite: Number(m[2]), points: [] });
  for (const bloc of sql.matchAll(/\(VALUES\n([\s\S]*?)\n\) AS p\(h, l\) WHERE m\.nom = '([^']+)'/g)) {
    out.get(bloc[2])!.points = [...bloc[1].matchAll(/\(([\d.]+),([\d.]+)\)/g)].map((p) => ({ hauteurCm: Number(p[1]), litres: Number(p[2]) }));
  }
  return out;
}

describe('barèmes livrés (migration 0073)', () => {
  const modeles = baremesMigration();

  it('les 4 modèles du parc, 3 avec barème', () => {
    expect([...modeles.keys()].sort()).toEqual(['Cuve 2000 L BigBang', 'Cuve 2000 L simple', 'Cuve 3000 L', 'Cuve 5000 L']);
    expect(modeles.get('Cuve 5000 L')!.points).toHaveLength(869);
    expect(modeles.get('Cuve 3000 L')!.points).toHaveLength(743);
    expect(modeles.get('Cuve 2000 L BigBang')!.points).toHaveLength(114);
    expect(modeles.get('Cuve 2000 L simple')!.points).toHaveLength(0);
  });

  // Garde de l'UNITÉ : DOC 1 et 2 étaient en mm. Lus en cm sans conversion, une
  // cuve de 5000 L aurait 17 m de haut. Une cuve couchée fait ~1 à 2 m de
  // diamètre, et son volume plein est proche de la capacité de la plaque.
  it.each(['Cuve 5000 L', 'Cuve 3000 L', 'Cuve 2000 L BigBang'])('%s : hauteurs en cm, volume plein proche de la capacité', (nom) => {
    const { capacite, points } = modeles.get(nom)!;
    expect(validerPointsBareme(points)).toHaveLength(points.length);
    const max = points[points.length - 1];
    expect(max.hauteurCm).toBeGreaterThan(80);
    expect(max.hauteurCm).toBeLessThan(250);
    const plein = volumeMaxLitres({ baremage: points })!;
    expect(Math.abs(plein - capacite) / capacite).toBeLessThan(0.1);
    // Cylindre couché : à mi-hauteur, la moitié du volume.
    expect(litresPourHauteur({ baremage: points }, max.hauteurCm / 2)! / plein).toBeCloseTo(0.5, 1);
  });

  it('valeurs du fichier source restituées (DOC 1 : 1746 mm = 5173 L ; DOC 2 : 504 mm = 939 L, cellule « 939+ »)', () => {
    expect(litresPourHauteur({ baremage: modeles.get('Cuve 5000 L')!.points }, 174.6)).toBe(5173);
    expect(litresPourHauteur({ baremage: modeles.get('Cuve 3000 L')!.points }, 50.4)).toBe(939);
    expect(litresPourHauteur({ baremage: modeles.get('Cuve 2000 L BigBang')!.points }, 60)).toBe(
      modeles.get('Cuve 2000 L BigBang')!.points.find((p) => p.hauteurCm === 60)!.litres,
    );
  });
});
