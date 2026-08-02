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

/**
 * Rejeu idempotent SÛR : la clé étant choisie par le client, un enregistrement
 * retrouvé par cette clé doit appartenir à l'appelant — sinon la branche
 * d'idempotence devenait une lecture arbitraire (IDOR) court-circuitant toute
 * validation. Renvoie l'enregistrement s'il est bien le sien, null sinon.
 */
export function memeAuteur<T extends { technicienId?: string | null; declarePar?: string | null }>(
  deja: T | null,
  userId: string
): T | null {
  if (!deja) return null;
  const auteur = deja.technicienId ?? deja.declarePar ?? null;
  return auteur === userId ? deja : null;
}
