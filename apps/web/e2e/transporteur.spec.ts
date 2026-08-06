import { test, expect } from '@playwright/test';
import { transporteur, seConnecter, verifierSessionVivante } from './outils';

/**
 * Parcours transporteur — l'aiguillage par rôle qui a conflictué avec le
 * tableau de bord général, et le cloisonnement de son menu.
 */
test.describe('Transporteur', () => {
  test.skip(!transporteur.email, 'E2E_TRANSPORTEUR_EMAIL/PASSWORD non fournis');

  test('atterrit sur SON tableau de bord, jamais le général', async ({ page }) => {
    await seConnecter(page, transporteur.email, transporteur.password);
    await expect(page.getByText('Mes chargements').first()).toBeVisible({ timeout: 15_000 });
    // Le général afficherait « Pouls du parc » : sa présence serait la régression.
    await expect(page.getByText('POULS DU PARC')).toHaveCount(0);
    await verifierSessionVivante(page, 2);
  });

  test('son menu est cloisonné : pas d’administration ni de rapports du parc', async ({ page }) => {
    await seConnecter(page, transporteur.email, transporteur.password);
    const menu = page.locator('aside nav');
    await expect(menu.getByText('Administration')).toHaveCount(0);
    await expect(menu.getByText('Rapports')).toHaveCount(0);
    await expect(menu.getByText('Sites')).toHaveCount(0);
  });

  test('sa carte des livraisons se charge, sans données d’exploitation', async ({ page }) => {
    await seConnecter(page, transporteur.email, transporteur.password);
    await page.goto('/supervision/carte');
    await expect(page.getByRole('heading', { name: 'Carte de mes livraisons' })).toBeVisible({ timeout: 20_000 });
  });
});
