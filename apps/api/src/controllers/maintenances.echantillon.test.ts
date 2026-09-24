import { echantillonner } from './maintenances.controller';

/**
 * Échantillon de photos du recueil PDF. Trois exigences, toutes vérifiables :
 * le document doit être REPRODUCTIBLE (un auditeur qui rééditera la même
 * période doit voir les mêmes photos), le tirage doit VARIER d'une
 * intervention à l'autre, et il doit être ÉQUITABLE — la première version
 * favorisait deux photos sur six.
 */
const PHOTOS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];

describe('echantillonner', () => {
  it('rend la liste telle quelle quand elle tient déjà dans le quota', () => {
    expect(echantillonner(['a', 'b'], 3, 'x')).toEqual(['a', 'b']);
  });

  it('donne le MÊME tirage à chaque édition (document reproductible)', () => {
    const a = echantillonner(PHOTOS, 3, 'mnt-1:APRES');
    const b = echantillonner(PHOTOS, 3, 'mnt-1:APRES');
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
  });

  it('varie d’une intervention à l’autre', () => {
    const tirages = new Set(
      Array.from({ length: 20 }, (_, i) => echantillonner(PHOTOS, 3, `mnt-${i}:APRES`).join(',')),
    );
    // Sans variation réelle, cet ensemble n'aurait qu'une poignée d'éléments.
    expect(tirages.size).toBeGreaterThan(8);
  });

  it('ne favorise aucune photo (tirage équitable)', () => {
    const compte: Record<string, number> = {};
    const tirs = 600;
    for (let i = 0; i < tirs; i++) {
      for (const p of echantillonner(PHOTOS, 1, `mnt-${i}:AVANT`)) compte[p] = (compte[p] ?? 0) + 1;
    }
    const attendu = tirs / PHOTOS.length; // 100
    for (const p of PHOTOS) {
      // ±40 % autour de l'espérance : large, mais le biais corrigé atteignait
      // +90 % sur deux photos et le test l'aurait attrapé.
      expect(compte[p] ?? 0).toBeGreaterThan(attendu * 0.6);
      expect(compte[p] ?? 0).toBeLessThan(attendu * 1.4);
    }
  });
});
