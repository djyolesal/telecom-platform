import { defineConfig, env } from 'prisma/config';

/**
 * Configuration CLI Prisma 7 (migrate, generate, studio).
 *
 * Depuis la v7, l'URL de connexion ne vit plus dans schema.prisma : la CLI la
 * lit ici, et le CLIENT reçoit la sienne par l'adapter pg (config/database.ts).
 *
 * La datasource est CONDITIONNELLE : `env('DATABASE_URL')` est résolu au
 * chargement du fichier, or `prisma generate` tourne dans l'étage de build
 * Docker, où aucune base n'existe — la déclarer sans condition y faisait
 * échouer le build. Sans la variable : generate fonctionne (il n'a pas besoin
 * de base), et migrate échoue avec le message clair de Prisma « datasource
 * requise ». Avec : docker compose la fournit au conteneur, et les commandes
 * locales la préfixent (`DATABASE_URL=... npx prisma ...`) — la v7 ne charge
 * plus .env toute seule.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  ...(process.env.DATABASE_URL ? { datasource: { url: env('DATABASE_URL') } } : {}),
});
