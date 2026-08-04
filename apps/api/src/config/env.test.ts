import { execFileSync } from 'child_process';
import path from 'path';

/**
 * Garde-fou de NON-RÉGRESSION sur le chargement de l'environnement.
 *
 * Incident du 04/08/2026 : `FILE_URL_SECRET: z.string().min(16).optional()`
 * refusait la CHAÎNE VIDE que docker-compose transmet (`${FILE_URL_SECRET:-}`)
 * quand la variable n'est pas dans le .env — `.optional()` n'accepte que
 * `undefined`. La validation échouait, `process.exit(1)` s'exécutait, l'API ne
 * démarrait plus : plus aucune connexion possible sur la plateforme.
 *
 * Ces tests chargent RÉELLEMENT le module dans un sous-processus (il appelle
 * process.exit, donc impossible de l'importer dans le processus de test).
 */

const MINIMUM = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: '0123456789abcdef0123456789abcdef',
  JWT_REFRESH_SECRET: 'fedcba9876543210fedcba9876543210',
  MINIO_ACCESS_KEY: 'minio',
  MINIO_SECRET_KEY: 'minio12345',
};

/** Charge src/config/env.ts dans un sous-processus → true si le boot réussit. */
function bootOk(extra: Record<string, string>): boolean {
  try {
    execFileSync(
      path.join(__dirname, '../../node_modules/.bin/ts-node'),
      ['-e', "import './src/config/env'; process.stdout.write('OK');"],
      {
        cwd: path.join(__dirname, '../..'),
        env: { ...process.env, ...MINIMUM, ...extra },
        stdio: 'pipe',
        timeout: 60_000,
      }
    );
    return true;
  } catch {
    return false;
  }
}

describe("chargement de l'environnement", () => {
  it('démarre quand FILE_URL_SECRET est une chaîne vide (défaut docker-compose)', () => {
    expect(bootOk({ FILE_URL_SECRET: '' })).toBe(true);
  });

  it('démarre quand FILE_URL_SECRET est absent', () => {
    const sans = { ...process.env } as Record<string, string>;
    delete sans.FILE_URL_SECRET;
    expect(bootOk({})).toBe(true);
  });

  it('démarre avec une clé de fichiers valide', () => {
    expect(bootOk({ FILE_URL_SECRET: 'a'.repeat(32) })).toBe(true);
  });

  it('REFUSE de démarrer avec une clé trop courte (intention de sécurité préservée)', () => {
    expect(bootOk({ FILE_URL_SECRET: 'trop-court' })).toBe(false);
  });
});
