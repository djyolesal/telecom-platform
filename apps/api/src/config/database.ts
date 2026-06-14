import { PrismaClient } from '@prisma/client';
import { env } from './env';

/**
 * Client Prisma unique (singleton) réutilisé dans toute l'application.
 * En développement, on le rattache à l'objet global pour éviter
 * la multiplication des connexions lors du hot-reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
