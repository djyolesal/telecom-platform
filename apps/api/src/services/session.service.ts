import { prisma } from '../config/database';
import { redisClient } from '../config/redis';

/**
 * Session unique par plateforme : chaque utilisateur n'a qu'UNE session web et
 * UNE session mobile actives à la fois. Le login génère un identifiant de
 * session (sid) embarqué dans les JWT ; un nouveau login sur la même plateforme
 * remplace le sid → les anciens jetons sont rejetés à la requête suivante.
 *
 * Source de vérité : colonnes users.session_web_id / session_mobile_id.
 * Redis sert de cache (sess:<plt>:<userId>) pour éviter une lecture SQL par requête.
 */
export type Plateforme = 'WEB' | 'MOBILE';

const CACHE_TTL_SECONDS = 24 * 60 * 60;

const cacheKey = (plt: Plateforme, userId: string) => `sess:${plt}:${userId}`;

export async function enregistrerSession(userId: string, plt: Plateforme, sid: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: plt === 'WEB' ? { sessionWebId: sid } : { sessionMobileId: sid },
  });
  await redisClient.setEx(cacheKey(plt, userId), CACHE_TTL_SECONDS, sid);
}

/**
 * Révoque TOUTES les sessions d'un utilisateur (web + mobile) : à appeler après
 * un changement/réinitialisation de mot de passe. Efface les sid en base et les
 * refresh tokens des deux plateformes — les jetons d'accès en cours expirent
 * d'eux-mêmes (≤ 12 h) puisque leur sid ne correspond plus à aucune session.
 */
export async function revoquerToutesSessions(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { sessionWebId: null, sessionMobileId: null } });
  await redisClient.del(cacheKey('WEB', userId));
  await redisClient.del(cacheKey('MOBILE', userId));
  await redisClient.del(`refresh:WEB:${userId}`);
  await redisClient.del(`refresh:MOBILE:${userId}`);
}

export async function effacerSession(userId: string, plt: Plateforme): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: plt === 'WEB' ? { sessionWebId: null } : { sessionMobileId: null },
  });
  await redisClient.del(cacheKey(plt, userId));
}

/** Sid actuellement actif pour cette plateforme (cache Redis, repli base). */
export async function sidCourant(userId: string, plt: Plateforme): Promise<string | null> {
  const cached = await redisClient.get(cacheKey(plt, userId));
  if (cached) return cached;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { sessionWebId: true, sessionMobileId: true },
  });
  const sid = (plt === 'WEB' ? u?.sessionWebId : u?.sessionMobileId) ?? null;
  if (sid) await redisClient.setEx(cacheKey(plt, userId), CACHE_TTL_SECONDS, sid);
  return sid;
}

/** Vrai si le sid du jeton est bien la session active de la plateforme. */
export async function sessionValide(userId: string, plt: Plateforme, sid: string): Promise<boolean> {
  return (await sidCourant(userId, plt)) === sid;
}
