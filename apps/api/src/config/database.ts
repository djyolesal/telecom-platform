import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from './env';

/**
 * Client Prisma unique (singleton) réutilisé dans toute l'application.
 *
 * Prisma 7 : le client ne lit plus l'URL dans schema.prisma — la connexion
 * passe par un driver adapter (ici `pg`). L'adapter gère son propre pool ;
 * `max` reste aligné sur le connection_limit historique de l'URL. En
 * développement, le singleton est rattaché à l'objet global pour éviter la
 * multiplication des pools lors du hot-reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function creerClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? creerClient();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
