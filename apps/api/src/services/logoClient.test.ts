import { cleLogoValide, logoClient } from './logoClient.service';

describe('clé de logo', () => {
  it('accepte les clés produites par l’upload (rangées par date)', () => {
    // Régression : le motif exigeait `logos/<fichier>` SANS sous-dossier, alors
    // que l'upload range par date. Tout logo déposé depuis le portail était
    // refusé à l'enregistrement — aucun prestataire ne pouvait en avoir un.
    expect(cleLogoValide('logos/2026-09-25/0c8f0a1e-1111-2222-3333-444455556666.png'))
      .toBe('logos/2026-09-25/0c8f0a1e-1111-2222-3333-444455556666.png');
    expect(cleLogoValide('logos/moov.jpeg')).toBe('logos/moov.jpeg');
  });

  it('refuse tout ce qui sort du dossier des logos', () => {
    // Le logo est relu tel quel et embarqué dans un document : une clé libre
    // exfiltrerait n'importe quel objet du bucket.
    expect(cleLogoValide('photos/2026-09-25/intervention.jpg')).toBeNull();
    expect(cleLogoValide('logos/../photos/2026-09-25/x.png')).toBeNull();
    expect(cleLogoValide('logos/x.pdf')).toBeNull();
    expect(cleLogoValide('logos/')).toBeNull();
    expect(cleLogoValide('')).toBeNull();
    expect(cleLogoValide(null)).toBeNull();
  });
});

describe('logo du client', () => {
  it('sert la marque livrée avec la plateforme quand rien n’est déposé', async () => {
    // Sans ce repli, un document contractuel sortirait sans enseigne tant que
    // personne n'a déposé de logo.
    const { logo, source, cle } = await logoClient();
    expect(source).toBe('defaut');
    expect(cle).toBeNull();
    expect(logo?.extension).toBe('jpeg');
    expect(logo!.buffer.subarray(0, 2).toString('hex')).toBe('ffd8'); // en-tête JPEG
  });
});
