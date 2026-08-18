import { cleDe } from './purge-orphelins';

/**
 * La purge ne doit JAMAIS considérer comme orphelin un objet référencé sous
 * une autre écriture : certaines colonnes historiques stockent l'URL complète
 * (ancien /storage public, nouvelle passerelle signée) au lieu de la clé nue.
 */
describe('cleDe - normalisation des références de stockage', () => {
  it('laisse une clé nue inchangée', () => {
    expect(cleDe('photos/2026-08-03/abc.jpg')).toBe('photos/2026-08-03/abc.jpg');
  });

  it("extrait la clé d'une ancienne URL publique /storage", () => {
    expect(cleDe('https://emops.uk/storage/telecom-files/photos/2026-07-01/x.jpg'))
      .toBe('photos/2026-07-01/x.jpg');
  });

  it("extrait la clé d'une URL signée de la passerelle (jeton ignoré)", () => {
    expect(cleDe('https://emops.uk/api/v1/files/bons-livraison/2026-08-03/y.pdf?t=1754000000.abc'))
      .toBe('bons-livraison/2026-08-03/y.pdf');
  });

  it("décode les caractères encodés d'une URL de passerelle", () => {
    expect(cleDe('/api/v1/files/documents/2026-08-03/bon%20livraison.pdf'))
      .toBe('documents/2026-08-03/bon livraison.pdf');
  });

  it('retire un / de tête et ignore vide/null', () => {
    expect(cleDe('/logos/l.png')).toBe('logos/l.png');
    expect(cleDe('')).toBeNull();
    expect(cleDe(null)).toBeNull();
    expect(cleDe('   ')).toBeNull();
  });
});
