import { cleVignette, PREFIXE_VIGNETTE } from './vignettes.service';
import { cleDe } from '../jobs/purge-orphelins';

describe('cache des vignettes', () => {
  it('dérive la clé de l’original, sans la perdre', () => {
    expect(cleVignette('photos/2026-09-25/abc.jpg')).toBe('vignettes/photos/2026-09-25/abc.jpg');
    expect(cleVignette('photos/x.jpg').startsWith(PREFIXE_VIGNETTE)).toBe(true);
  });

  it('reste déductible depuis une URL signée (ménage nocturne)', () => {
    // Le job de purge recense les clés référencées puis y ajoute la vignette :
    // sans cela, il effaçait chaque nuit un cache que le rapport suivant
    // devait recalculer photo par photo.
    const cle = cleDe('https://emops.uk/api/v1/files/photos/2026-09-25/abc.jpg?t=xyz');
    expect(cle).toBe('photos/2026-09-25/abc.jpg');
    expect(cleVignette(cle!)).toBe('vignettes/photos/2026-09-25/abc.jpg');
  });
});
