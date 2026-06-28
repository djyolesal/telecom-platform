// Valeurs factices pour satisfaire la validation d'environnement (config/env.ts)
// lors de l'import des modules sous test. Aucune connexion réelle n'est ouverte.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://u:p@localhost:5432/test';
process.env.MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'test';
process.env.MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-jwt-refresh-0123456789';
