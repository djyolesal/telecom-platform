-- Session unique par plateforme (web / mobile) : identifiant de session courant
-- par utilisateur, embarqué dans les JWT et vérifié à chaque requête.
ALTER TABLE "users" ADD COLUMN "session_web_id" TEXT;
ALTER TABLE "users" ADD COLUMN "session_mobile_id" TEXT;
