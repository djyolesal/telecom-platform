import { test, expect } from '@playwright/test';
import { admin, seConnecter, verifierSessionVivante } from './outils';

/**
 * Authentification — le risque n°1 de chaque montée de version (Next 15,
 * next-auth bêta.32). Ces tests couvrent exactement les régressions vécues :
 * session cliente nulle (menu vide, avatar « U »), aiguillage par rôle.
 */
test.describe('Authentification', () => {
  test.skip(!admin.email, 'E2E_ADMIN_EMAIL/PASSWORD non fournis');

  test('un mauvais mot de passe est refusé, sans fuite d’information', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('vous@telecom.tg').fill(admin.email);
    await page.locator('input[type="password"]').fill('mauvais-mot-de-passe');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Email ou mot de passe incorrect')).toBeVisible();
    expect(page.url()).toContain('/login');
  });

  test('connexion admin : session complète dès le premier écran', async ({ page }) => {
    await seConnecter(page, admin.email, admin.password);
    // Menu peuplé = session cliente vivante (le témoin du bug de rate-limit).
    await verifierSessionVivante(page, 5);
    // L'avatar ne doit PAS être le repli « U » d'une session nulle : le nom
    // de l'utilisateur est affiché à côté.
    await expect(page.locator('aside').getByText(/[A-Za-zÀ-ÿ]{2,}/).last()).toBeVisible();
  });

  test('une page protégée sans session renvoie au login', async ({ page }) => {
    await page.goto('/carburant/stock');
    await page.waitForURL('**/login**');
    expect(page.url()).toContain('callbackUrl');
  });

  test('déconnexion : retour au login, plus d’accès aux pages protégées', async ({ page }) => {
    await seConnecter(page, admin.email, admin.password);
    await page.locator('aside button').last().click(); // bouton de déconnexion en bas de barre
    await page.waitForURL('**/login**', { timeout: 15_000 });
    await page.goto('/dashboard');
    await page.waitForURL('**/login**');
  });
});
