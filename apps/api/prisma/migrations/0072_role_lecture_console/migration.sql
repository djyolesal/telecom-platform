-- RÔLE DE LECTURE DE LA CONSOLE SQL (Administration > Base de données).
--
-- L'application se connecte à la base avec un SUPERUTILISATEUR. Exécuter une
-- requête saisie à la main sous cette identité, même « en lecture seule »,
-- c'est laisser lire l'empreinte des mots de passe, appeler les fonctions
-- réservées (lecture de fichiers du serveur, arrêt de connexions) et, avec un
-- peu d'astuce, sortir de la lecture seule.
--
-- La console bascule donc, le temps de CHAQUE requête, sur ce rôle :
--   - NOLOGIN : on ne s'y connecte pas, on l'endosse (SET LOCAL ROLE) ;
--   - SELECT sur toutes les tables, sauf les colonnes sensibles de `users` ;
--   - aucun autre droit : ni écriture, ni fonction d'administration.
-- La garantie vient de PostgreSQL, pas d'une analyse du texte de la requête.
--
-- Bloc défensif : sans le droit de créer un rôle, la migration NE DOIT PAS
-- échouer (elle bloquerait tout le déploiement). La console SQL constate alors
-- l'absence du rôle et refuse de s'ouvrir.
DO $$
DECLARE
  col record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'emops_lecture') THEN
    CREATE ROLE emops_lecture NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;

  GRANT USAGE ON SCHEMA public TO emops_lecture;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO emops_lecture;
  -- Les tables créées par les migrations à venir seront lisibles aussi.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO emops_lecture;

  -- `users` : toutes les colonnes SAUF l'empreinte du mot de passe et le jeton
  -- de notification du téléphone. Le droit de table est retiré, puis rendu
  -- colonne par colonne (une colonne ajoutée plus tard n'est pas lisible tant
  -- qu'une migration ne l'accorde pas : l'erreur est dans le bon sens).
  REVOKE SELECT ON TABLE users FROM emops_lecture;
  FOR col IN
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'users'
       AND column_name NOT IN ('password_hash', 'fcm_token')
  LOOP
    EXECUTE format('GRANT SELECT (%I) ON TABLE users TO emops_lecture', col.column_name);
  END LOOP;

  -- L'utilisateur de l'application doit pouvoir endosser le rôle. Inutile pour
  -- un superutilisateur, indispensable sinon.
  EXECUTE format('GRANT emops_lecture TO %I', current_user);
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Rôle emops_lecture non créé (droits insuffisants) : la console SQL restera fermée.';
END
$$;
