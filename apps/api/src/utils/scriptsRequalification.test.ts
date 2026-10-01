import { readFileSync } from 'fs';
import path from 'path';
import { TASK_BY_KEY } from './tachesPreventives';

/**
 * Le script de requalification tourne DANS L'IMAGE DE PRODUCTION, qui ne
 * contient que `dist/` : il ne peut pas importer `src/utils/tachesPreventives`
 * (échec au lancement, constaté le 01/10/2026). Il recopie donc le libellé
 * contractuel. Ce test est le prix de cette copie : si le catalogue change et
 * pas le script, les interventions requalifiées porteraient un intitulé périmé,
 * et personne ne s'en apercevrait avant de lire une fiche signée.
 */
const SCRIPT = path.join(__dirname, '../../prisma/scripts/requalifier-ge-hybrides.ts');

describe('script de requalification des GE hybrides', () => {
  const source = readFileSync(SCRIPT, 'utf8');

  it('recopie exactement le libellé contractuel du catalogue', () => {
    const m = source.match(/const LIBELLE_CONTRACTUEL = '([^']+)'/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(TASK_BY_KEY['ge_secours'].libelle);
  });

  it('ne dépend pas de `src/` : introuvable dans l’image de production', () => {
    expect(source).not.toMatch(/from '\.\.\/\.\.\/src\//);
  });

  it('vise bien les deux clés du contrat', () => {
    expect(source).toMatch(/const ANCIENNE = 'ge_production';/);
    expect(source).toMatch(/const NOUVELLE = 'ge_secours';/);
    expect(TASK_BY_KEY['ge_production']).toBeDefined();
    expect(TASK_BY_KEY['ge_secours']).toBeDefined();
  });
});
