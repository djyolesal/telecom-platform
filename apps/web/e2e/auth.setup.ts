import { test as setup } from '@playwright/test';
import { admin, transporteur, seConnecter } from './outils';

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
setup('session admin', async ({ page }) => {
  if (admin.email) await seConnecter(page, admin.email, admin.password);
  await page.context().storageState({ path: 'e2e/.auth/admin.json' });
});

setup('session transporteur', async ({ page }) => {
  if (transporteur.email) await seConnecter(page, transporteur.email, transporteur.password);
  await page.context().storageState({ path: 'e2e/.auth/transporteur.json' });
});
