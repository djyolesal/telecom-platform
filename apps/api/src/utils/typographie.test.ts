import fs from 'fs';
import path from 'path';

/**
 * CONVENTION : pas de tiret cadratin « — » dans un texte VISIBLE (interface web,
 * mobile, PDF, e-mails, SMS). Le trait d'union « - » partout.
 *
 * Décision du 25/09/2026. Le cadratin passe mal d'un support à l'autre : il
 * casse dans certains clients mail, dans les SMS, et à l'export CSV ouvert sous
 * un encodage approximatif. Ce test garde la règle vraie après coup — une
 * convention qui ne tient qu'à la mémoire de celui qui l'a posée ne tient pas.
 *
 * Les COMMENTAIRES de code n'en font pas partie : ils ne s'affichent nulle part.
 */
/** Le caractère est construit, jamais écrit : ce fichier serait sinon son
 *  propre contre-exemple. */
const CADRATIN = String.fromCharCode(0x2014);

const RACINE = path.resolve(__dirname, '../../../..');
const DOSSIERS = ['apps/api/src', 'apps/web/app', 'apps/web/components', 'apps/web/lib', 'apps/mobile/lib'];
const EXTENSIONS = ['.ts', '.tsx', '.dart'];

/** Positions situées dans un commentaire (// … , /* … *​/), chaînes respectées. */
function masqueCommentaires(src: string): boolean[] {
  const m = new Array<boolean>(src.length).fill(false);
  let i = 0;
  let chaine: string | null = null;
  while (i < src.length) {
    const c = src[i];
    if (chaine) {
      if (c === '\\') { i += 2; continue; }
      if (c === chaine) chaine = null;
      i++; continue;
    }
    if (c === '\'' || c === '"' || c === '`') { chaine = c; i++; continue; }
    if (src.startsWith('//', i)) {
      const j = src.indexOf('\n', i);
      const fin = j < 0 ? src.length : j;
      for (let k = i; k < fin; k++) m[k] = true;
      i = fin; continue;
    }
    if (src.startsWith('/*', i)) {
      const j = src.indexOf('*/', i + 2);
      const fin = j < 0 ? src.length : j + 2;
      for (let k = i; k < fin; k++) m[k] = true;
      i = fin; continue;
    }
    i++;
  }
  return m;
}

function fichiers(dir: string): string[] {
  const abs = path.join(RACINE, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...fichiers(rel));
    else if (EXTENSIONS.includes(path.extname(e.name))) out.push(rel);
  }
  return out;
}

describe('typographie des textes visibles', () => {
  it('n’utilise pas le tiret cadratin hors commentaires', () => {
    const fautifs: string[] = [];
    for (const f of DOSSIERS.flatMap(fichiers)) {
      const src = fs.readFileSync(path.join(RACINE, f), 'utf8');
      if (!src.includes(CADRATIN)) continue;
      const m = masqueCommentaires(src);
      for (let i = 0; i < src.length; i++) {
        if (src[i] === CADRATIN && !m[i]) {
          fautifs.push(`${f}:${src.slice(0, i).split('\n').length}`);
        }
      }
    }
    expect(fautifs).toEqual([]);
  });
});
