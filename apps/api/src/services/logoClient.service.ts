import fs from 'fs/promises';
import path from 'path';
import { getObjectBuffer } from './storage.service';
import { getRaw } from './settings.service';
import { FicheLogo } from './ficheValidation.service';

/**
 * Clé MinIO d'un logo, telle qu'elle est relue pour être embarquée dans un
 * document. Sans contrainte, un compte administrateur pourrait pointer
 * n'importe quel objet du bucket (photos d'intervention, pièces jointes) et
 * l'exfiltrer dans un classeur ou un PDF.
 *
 * Les clés produites par l'upload portent un segment de date
 * (`logos/2026-09-25/<uuid>.png`) : le motif accepte les sous-dossiers, et
 * refuse explicitement « .. », que la classe de caractères laisserait passer.
 */
export function cleLogoValide(v: unknown): string | null {
  if (v == null || v === '') return null;
  const k = String(v).trim();
  if (!/^logos\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\.(png|jpe?g|gif)$/i.test(k)) return null;
  if (k.split('/').includes('..')) return null;
  return k;
}

const extensionDe = (nom: string): FicheLogo['extension'] =>
  /\.png$/i.test(nom) ? 'png' : /\.gif$/i.test(nom) ? 'gif' : 'jpeg';

/** Charge un logo depuis le bucket. Un logo illisible ne doit jamais empêcher
 *  la sortie d'un document : on le remplace par du texte. */
export async function chargerLogo(key?: string | null): Promise<FicheLogo | null> {
  const cle = cleLogoValide(key);
  if (!cle) return null;
  try {
    return { buffer: await getObjectBuffer(cle), extension: extensionDe(cle) };
  } catch {
    return null;
  }
}

/** Marque livrée avec la plateforme, utilisée tant qu'aucune n'a été déposée. */
const CHEMIN_DEFAUT = path.join(__dirname, '..', '..', 'assets', 'logo-client-defaut.jpeg');

export type SourceLogoClient = 'parametre' | 'environnement' | 'defaut' | 'aucun';

/**
 * Logo du CLIENT sur les documents contractuels (fiche de validation, rapport
 * mensuel d'activité).
 *
 * Ordre : le paramètre déposé dans Administration → Paramètres, puis
 * CLIENT_LOGO_KEY (déploiements antérieurs au paramètre), puis la marque
 * livrée avec la plateforme — un document doit sortir à la bonne enseigne
 * sans aucune manipulation préalable.
 */
export async function logoClient(): Promise<{ logo: FicheLogo | null; source: SourceLogoClient; cle: string | null }> {
  const cleParametre = cleLogoValide(getRaw('client.logoKey'));
  if (cleParametre) {
    const logo = await chargerLogo(cleParametre);
    if (logo) return { logo, source: 'parametre', cle: cleParametre };
  }
  const cleEnv = cleLogoValide(process.env.CLIENT_LOGO_KEY);
  if (cleEnv) {
    const logo = await chargerLogo(cleEnv);
    if (logo) return { logo, source: 'environnement', cle: cleEnv };
  }
  try {
    return {
      logo: { buffer: await fs.readFile(CHEMIN_DEFAUT), extension: extensionDe(CHEMIN_DEFAUT) },
      source: 'defaut', cle: null,
    };
  } catch {
    return { logo: null, source: 'aucun', cle: null };
  }
}
