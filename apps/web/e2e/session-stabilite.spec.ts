import { test, expect } from '@playwright/test';
import { admin, seConnecter, verifierSessionVivante } from './outils';

/**
 * Stabilité de session en navigation soutenue — la reproduction du bug de
 * production : le rate-limit nginx sur /api/auth/session tuait la session
 * cliente au bout de quelques pages (menu vide, données à zéro, 429).
 */
test.describe('Stabilité de session', () => {
  test.skip(!admin.email, 'E2E_ADMIN_EMAIL/PASSWORD non fournis');

  test('la session survit à une navigation rapide sur 8 pages, sans aucun 429', async ({ page }) => {
    const refus429: string[] = [];
    page.on('response', (r) => { if (r.status() === 429) refus429.push(r.url()); });

    await seConnecter(page, admin.email, admin.password);

    const pages = [
      '/dashboard', '/sites', '/carburant/stock', '/carburant/commandes',
      '/carburant/bilan', '/energie/bilan', '/supervision/carte', '/rapports',
    ];
    for (const url of pages) {
      await page.goto(url);
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
      // À CHAQUE page : le menu doit rester peuplé — s'il se vide, la session
      // cliente est morte en route (la régression exacte du 05/08).
      await verifierSessionVivante(page, 5);
    }

    expect(refus429, `Réponses 429 reçues : ${refus429.join(', ')}`).toHaveLength(0);
  });
});
