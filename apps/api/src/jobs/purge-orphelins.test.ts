import { cleDe, CHAMPS_FICHIERS } from './purge-orphelins';

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

/**
 * Garde-fou : toute colonne du schéma qui stocke un fichier doit être connue
 * de la purge. Sinon ses fichiers sont effacés 7 jours après l'envoi (c'est
 * arrivé aux certificats de jaugeage des camions, entre autres).
 */
describe('CHAMPS_FICHIERS couvre le schéma Prisma', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path') as typeof import('path');
  const schema = fs.readFileSync(path.join(__dirname, '../../prisma/schema.prisma'), 'utf8');

  const colonnesFichiers: string[] = [];
  let modele = '';
  for (const ligne of schema.split('\n')) {
    const m = /^model (\w+) \{/.exec(ligne);
    if (m) { modele = m[1].charAt(0).toLowerCase() + m[1].slice(1); continue; }
    const champ = /^\s+(\w+)\s+String\??/.exec(ligne);
    if (champ && /(Path|MinioKey|^minioKey)$/.test(champ[1])) colonnesFichiers.push(`${modele}.${champ[1]}`);
  }

  it('repère bien les colonnes de fichiers (contrôle du contrôle)', () => {
    expect(colonnesFichiers).toEqual(expect.arrayContaining(['vehicule.certificatJaugeagePath', 'photo.minioKey', 'rapportMensuel.ficheMinioKey']));
  });

  it.each(colonnesFichiers)('%s est protégée de la purge', (col) => {
    const [m, c] = col.split('.');
    expect(CHAMPS_FICHIERS[m] ?? []).toContain(c);
  });
});
