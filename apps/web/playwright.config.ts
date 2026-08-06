import { defineConfig } from '@playwright/test';

/**
 * Recette automatisée E2E — pensée pour tourner contre un environnement QUI
 * EXISTE (compose local, staging, ou la prod juste après bascule), pas pour
 * démarrer la pile elle-même.
 *
 *   E2E_BASE_URL              cible (défaut http://localhost:3000)
 *   E2E_ADMIN_EMAIL/PASSWORD  compte admin de recette (obligatoire)
 *   E2E_TRANSPORTEUR_EMAIL/PASSWORD  compte transporteur (sinon specs sautées)
 *
 * Les identifiants ne sont JAMAIS commités : variables d'environnement
 * uniquement, saisies par l'opérateur au moment de la recette.
 *
 * ⚠ Contre la prod : la recette se limite à des LECTURES (aucun test ici ne
 * crée d'incident ni de BL — la passerelle SMS est réelle).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  retries: 1,
  workers: 1, // séquentiel : le rate-limit nginx est par IP, on ne se DoS pas soi-même
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'fr-FR',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'chromium', dependencies: ['setup'], testIgnore: /auth\.setup\.ts/ },
  ],
});
