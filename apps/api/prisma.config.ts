import { defineConfig, env } from 'prisma/config';

/**
 * Configuration CLI Prisma 7 (migrate, generate, studio).
 *
 * Depuis la v7, l'URL de connexion ne vit plus dans schema.prisma : la CLI la
 * lit ici, et le CLIENT reçoit la sienne par l'adapter pg (config/database.ts).
 * `env('DATABASE_URL')` est résolu AU MOMENT de la commande — docker compose
 * fournit la variable au conteneur, et les commandes locales la préfixent
 * (`DATABASE_URL=... npx prisma ...`) : la v7 ne charge plus .env toute seule.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
