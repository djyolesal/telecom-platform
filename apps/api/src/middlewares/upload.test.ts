import { typeReel } from './upload';

/**
 * Le filtre Multer se fie au `Content-Type` déclaré par le client. Ces tests
 * verrouillent la vérification des octets réels, seule barrière contre un
 * fichier HTML/SVG piégé annoncé comme une image.
 */
function avec(prefixe: number[], taille = 32): Buffer {
  const b = Buffer.alloc(taille);
  Buffer.from(prefixe).copy(b);
  return b;
}

describe('typeReel — signatures de fichiers', () => {
  it('reconnaît un JPEG', () => {
    expect(typeReel(avec([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  it('reconnaît un PNG', () => {
    expect(typeReel(avec([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
  });

  it('reconnaît un WEBP (RIFF….WEBP)', () => {
    const b = Buffer.alloc(32);
    b.write('RIFF', 0, 'latin1');
    b.write('WEBP', 8, 'latin1');
    expect(typeReel(b)).toBe('image/webp');
  });

  it('reconnaît un HEIC (boîte ftyp)', () => {
    const b = Buffer.alloc(32);
    b.write('ftyp', 4, 'latin1');
    b.write('heic', 8, 'latin1');
    expect(typeReel(b)).toBe('image/heic');
  });

  it('reconnaît un PDF', () => {
    const b = Buffer.alloc(32);
    b.write('%PDF-1.7', 0, 'latin1');
    expect(typeReel(b)).toBe('application/pdf');
  });

  it("rejette du HTML déguisé en image (le cas qui motive ce contrôle)", () => {
    const b = Buffer.from('<html><script>fetch("//x")</script></html>');
    expect(typeReel(b)).toBeNull();
  });

  it('rejette un SVG (exécutable dans un navigateur)', () => {
    expect(typeReel(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });

  it('rejette un fichier trop court pour porter une signature', () => {
    expect(typeReel(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });
});
