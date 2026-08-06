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
    await expect(page.getByText('Bilan conso & stock')).toBeVisible();
    await expect(page.getByText('Stock début')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Sites mesurés')).toBeVisible();
  });

  test('bilan énergie : KPIs et sources affichés', async ({ page }) => {
    await seConnecter(page, admin.email, admin.password);
    await page.goto('/energie/bilan');
    await expect(page.getByText('Bilan énergie CEET')).toBeVisible();
    await expect(page.getByText(/delta d.index/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('suivi des manquants : les onglets répondent', async ({ page }) => {
    await seConnecter(page, admin.email, admin.password);
    await page.goto('/carburant/manquants');
    await expect(page.getByText('Suivi des manquants de livraison')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Par chauffeur' }).click();
    await page.getByRole('button', { name: 'À traiter' }).click();
  });
});
