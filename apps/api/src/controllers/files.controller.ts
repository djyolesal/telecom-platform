import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
import { verifierJeton, statObject, getObjectStream } from '../services/storage.service';

/**
 * Passerelle de lecture des objets du stockage.
 *
 * Remplace l'exposition directe du bucket MinIO (`/storage/telecom-files/…`),
 * qui était en lecture publique : la clé suffisait à récupérer une photo
 * d'intervention ou une signature. Ici, l'URL doit porter un jeton HMAC valide
 * et non expiré, émis par l'API pour un utilisateur authentifié.
 *
 * Route volontairement hors du `authMiddleware` : une balise <img> ne peut pas
 * poser d'en-tête Authorization — c'est la signature qui fait foi.
 */
export async function servirFichier(req: Request, res: Response, next: NextFunction) {
  try {
    // Clé = tout ce qui suit /files/ ; on refuse la traversée de chemin.
    const cle = decodeURIComponent(String((req.params as Record<string, string>)[0] ?? ''));
    if (!cle || cle.includes('..') || cle.startsWith('/')) throw new AppError('Fichier introuvable', 404);

    const jeton = String(req.query.t ?? '');
    if (!verifierJeton(cle, jeton)) throw new AppError('Lien expiré ou invalide', 403);

    const meta = await statObject(cle).catch(() => null);
    if (!meta) throw new AppError('Fichier introuvable', 404);

    const type = String(meta.metaData?.['content-type'] ?? 'application/octet-stream');
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(meta.size));
    // `inline` + nosniff : un objet mal typé ne doit pas s'exécuter comme du HTML.
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Privé : jamais mis en cache par un proxy intermédiaire partagé.
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const flux = await getObjectStream(cle);
    flux.on('error', next);
    flux.pipe(res);
  } catch (err) { next(err); }
}
