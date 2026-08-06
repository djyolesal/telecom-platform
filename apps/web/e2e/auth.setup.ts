import { expect, test as setup } from '@playwright/test';
import { admin, transporteur, seConnecter, verifierSessionVivante } from './outils';

/**
 * Connexion UNIQUE par rôle, session réutilisée par les specs (storageState).
 *
 * L'API limite les connexions à 10 par compte par 15 minutes (anti-spraying) :
 * une suite qui se reconnecte à chaque test vidait le quota du compte admin en
 * deux passages — et le refus tombait sur un test au hasard de la fenêtre.
 * Ici : 1 login par rôle, plus les deux tests d'auth qui exercent VRAIMENT le
 * formulaire. Total ≤ 3 logins admin par passage, retries compris.
 *
 * Le fichier d'état est TOUJOURS écrit (même vide, sans identifiants) : les
 * specs le chargent à la création du contexte, avant leurs test.skip.
 */
setup('session admin (et test de connexion)', async ({ page }) => {
  if (admin.email) {
    await seConnecter(page, admin.email, admin.password);
    // Le setup EST le test de connexion : la plateforme n'autorise qu'UNE
    // session web par compte (sid — durcissement audit nº2), donc tout login
    // admin ultérieur RÉVOQUERAIT la session sauvée ici et ferait échouer
    // toutes les specs qui la rejouent (constaté : le test de connexion
    // séparé tuait la session du setup). Un seul login, assertions incluses.
    await verifierSessionVivante(page, 5);
    // L'avatar ne doit pas être le repli « U » d'une session nulle.
    await expect(page.locator('aside').getByText(/[A-Za-zÀ-ÿ]{2,}/).last()).toBeVisible();
  }
  await page.context().storageState({ path: 'e2e/.auth/admin.json' });
});

setup('session transporteur', async ({ page }) => {
  if (transporteur.email) await seConnecter(page, transporteur.email, transporteur.password);
  await page.context().storageState({ path: 'e2e/.auth/transporteur.json' });
});
