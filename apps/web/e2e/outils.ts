import { expect, type Page } from '@playwright/test';

export const admin = {
  email: process.env.E2E_ADMIN_EMAIL ?? '',
  password: process.env.E2E_ADMIN_PASSWORD ?? '',
};
export const transporteur = {
  email: process.env.E2E_TRANSPORTEUR_EMAIL ?? '',
  password: process.env.E2E_TRANSPORTEUR_PASSWORD ?? '',
};

/** Connexion par le formulaire réel (pas d'injection de cookie : on teste le vrai chemin). */
export async function seConnecter(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('vous@telecom.tg').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  // Le login fait une navigation COMPLÈTE vers /dashboard (correctif session).
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
}

/**
 * La barre latérale est le témoin de santé de la session : quand la session
 * cliente meurt (le bug du rate-limit), le menu se VIDE et l'avatar retombe
 * sur « U ». Toute page authentifiée doit donc montrer un menu peuplé.
 */
export async function verifierSessionVivante(page: Page, minEntrees = 3): Promise<void> {
  const entrees = page.locator('aside nav a');
  await expect(entrees.first()).toBeVisible({ timeout: 10_000 });
  expect(await entrees.count()).toBeGreaterThanOrEqual(minEntrees);
}
