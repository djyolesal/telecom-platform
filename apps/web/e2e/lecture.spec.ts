import { test, expect } from '@playwright/test';
import { admin, seConnecter } from './outils';

/**
 * Pages de synthèse en LECTURE seule (aucune écriture : la recette peut tourner
 * contre la prod sans déclencher ni SMS ni données).
 */
test.describe('Pages de synthèse', () => {
  test.skip(!admin.email, 'E2E_ADMIN_EMAIL/PASSWORD non fournis');

  test('bilan carburant : période, KPIs et courbe répondent', async ({ page }) => {
    await seConnecter(page, admin.email, admin.password);
    await page.goto('/carburant/bilan');
    // getByRole h1 : « Bilan conso & stock » existe AUSSI dans le menu latéral,
    // et « Stock début » dans l'en-tête du tableau — getByText nu violait le
    // mode strict de Playwright (plusieurs correspondances).
    await expect(page.getByRole('heading', { name: 'Bilan conso & stock' })).toBeVisible();
    await expect(page.getByText('Stock début').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Sites mesurés').first()).toBeVisible();
  });

  test('bilan énergie : KPIs et sources affichés', async ({ page }) => {
    await seConnecter(page, admin.email, admin.password);
    await page.goto('/energie/bilan');
    await expect(page.getByRole('heading', { name: 'Bilan énergie CEET' })).toBeVisible();
    await expect(page.getByText(/delta d.index/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('suivi des manquants : les onglets répondent', async ({ page }) => {
    await seConnecter(page, admin.email, admin.password);
    await page.goto('/carburant/manquants');
    await expect(page.getByRole('heading', { name: 'Suivi des manquants de livraison' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Par chauffeur' }).click();
    await page.getByRole('button', { name: 'À traiter' }).click();
  });
});
