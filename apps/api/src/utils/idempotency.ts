import { Request } from 'express';

/**
 * Clé d'idempotence fournie par le client mobile via le header `Idempotency-Key`
 * (un UUID stable réutilisé sur les rejeux de la file offline). Retourne la clé
 * validée (format UUID) ou null. Utilisée comme identifiant de l'entité créée
 * → un rejeu retrouve l'enregistrement existant au lieu d'en créer un doublon.
 */
export function idempotencyKey(req: Request): string | null {
  const raw = req.header('Idempotency-Key');
  return raw && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
}
