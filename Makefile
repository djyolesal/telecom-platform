.PHONY: help install start stop restart logs backup restore reset-sites update status migrate ssl clean

help:
	@echo ""
	@echo "╔══════════════════════════════════════════════════╗"
	@echo "║      PLATEFORME TÉLÉCOM — Commandes Make         ║"
	@echo "╚══════════════════════════════════════════════════╝"
	@echo "  make install     Installation initiale complète"
	@echo "  make start       Démarrer tous les services"
	@echo "  make stop        Arrêter tous les services"
	@echo "  make restart     Redémarrer tous les services"
	@echo "  make status      État et ressources des conteneurs"
	@echo "  make logs        Logs en temps réel (tous)"
	@echo "  make logs-api    Logs API Node.js"
	@echo "  make logs-web    Logs Next.js"
	@echo "  make logs-db     Logs PostgreSQL"
	@echo "  make migrate     Appliquer migrations Prisma"
	@echo "  make backup      Backup BDD maintenant"
	@echo "  make restore     Restaurer un backup"
	@echo "  make reset-sites Vider sites + données liées (sauvegarde auto)"
	@echo "  make update      Mettre à jour l'application"
	@echo "  make ssl         Renouveler certificats SSL"
	@echo "  make clean       Nettoyer images/conteneurs inutilisés"
	@echo ""

install:
	@echo "--- [1/6] Création des répertoires de données ---"
	@mkdir -p /opt/telecom/data/{postgres,redis,minio,grafana,prometheus}
	@mkdir -p /opt/telecom/{logs,backups,ssl}
	@chmod -R 755 /opt/telecom
	@chmod 700 /opt/telecom/backups
	@echo "--- [2/6] Vérification du fichier .env ---"
	@test -f .env || (cp .env.example .env && echo "⚠️  .env créé depuis .env.example — ÉDITEZ-LE avant de continuer !" && exit 1)
	@echo "--- [3/6] Build des images Docker ---"
	@docker compose build --no-cache
	@echo "--- [4/6] Démarrage PostgreSQL + Redis + MinIO ---"
	@docker compose up -d postgres redis minio
	@echo "Attente démarrage base de données (15s)..."
	@sleep 15
	@echo "--- [5/6] Migrations Prisma + seed initial ---"
	@docker compose run --rm api npx prisma migrate deploy
	@docker compose run --rm api node dist-seed/seed.js
	@echo "--- [6/6] Démarrage complet ---"
	@docker compose up -d
	@echo ""
	@echo "✅ Installation terminée !"
	@echo "   Portail web  : https://$$(grep DOMAIN .env | cut -d= -f2)"
	@echo "   (Swagger désactivé en production — disponible sur /docs en dev)"
	@echo "   Grafana      : https://$$(grep DOMAIN .env | cut -d= -f2)/grafana"

start:
	@docker compose up -d
	@echo "✅ Services démarrés"

stop:
	@docker compose down
	@echo "✅ Services arrêtés"

restart:
	@docker compose down && docker compose up -d
	@echo "✅ Services redémarrés"

status:
	@echo "=== État des conteneurs ==="
	@docker compose ps
	@echo ""
	@echo "=== Utilisation des ressources ==="
	@docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}"
	@echo ""
	@echo "=== Espace disque volumes ==="
	@docker system df -v 2>/dev/null | grep -A5 "Volumes"

logs:
	@docker compose logs -f --tail=100

logs-api:
	@docker compose logs -f api --tail=200

logs-web:
	@docker compose logs -f web --tail=100

logs-db:
	@docker compose logs -f postgres --tail=100

logs-nginx:
	@docker compose logs -f nginx --tail=100

migrate:
	@docker compose exec api npx prisma migrate deploy
	@echo "✅ Migrations appliquées"

backup:
	@# Sauvegarde COMPLÈTE (base + fichiers MinIO + copie hors-site si BACKUP_REMOTE).
	@# Source unique de vérité, appelée par le cron système (voir setup-server.sh).
	@bash infra/scripts/backup.sh
	@echo "=== Sauvegardes disponibles ==="
	@ls -lh /opt/telecom/backups/db_*.sql.gz /opt/telecom/backups/minio_*.tar.gz 2>/dev/null || echo "(aucune)"

reset-sites:
	@echo "⚠️  RESET COMPLET DES SITES"
	@echo "    Supprime DÉFINITIVEMENT : sites + maintenances + pièces + relevés énergie + dépotages + incidents + photos."
	@echo "    (lots, prestataires, utilisateurs sont conservés)"
	@read -p "Tapez 'RESET' pour confirmer : " CONF; \
	if [ "$$CONF" != "RESET" ]; then echo "❌ Annulé."; exit 1; fi; \
	echo "=== Sauvegarde préalable ==="; \
	$(MAKE) backup || { echo "❌ Sauvegarde échouée — purge annulée."; exit 1; }; \
	echo "=== Purge des tables ==="; \
	docker compose exec -T postgres psql \
		-U $$(grep POSTGRES_USER .env | cut -d= -f2) \
		-d $$(grep POSTGRES_DB .env | cut -d= -f2) \
		-c "TRUNCATE TABLE photos, pieces_rechange, releves_energie, depotages, maintenances, incidents, sites RESTART IDENTITY CASCADE;"; \
	echo "✅ Sites et données liées vidés. Importez la nouvelle liste : Sites → Importer."

restore:
	@echo "=== Backups disponibles ==="
	@ls -lh /opt/telecom/backups/*.sql.gz 2>/dev/null || (echo "Aucun backup trouvé" && exit 1)
	@read -p "Nom du fichier à restaurer (ex: backup_20260610_020000.sql.gz) : " FILE; \
	echo "⚠️  Cette opération va ÉCRASER la base de données actuelle !"; \
	read -p "Confirmer ? (oui/non) : " CONFIRM; \
	if [ "$$CONFIRM" = "oui" ]; then \
		gunzip -c /opt/telecom/backups/$$FILE | \
		docker compose exec -T postgres psql \
			-U $$(grep POSTGRES_USER .env | cut -d= -f2) \
			$$(grep POSTGRES_DB .env | cut -d= -f2); \
		echo "✅ Restauration terminée"; \
	else \
		echo "Annulé"; \
	fi

update:
	@echo "--- Pull du code source ---"
	@git pull origin main
	@echo "--- Rebuild images ---"
	@docker compose build api web
	@echo "--- Redémarrage sans interruption ---"
	@docker compose up -d --no-deps --build api web
	@echo "--- Migrations BDD ---"
	@docker compose exec api npx prisma migrate deploy
	@echo "✅ Mise à jour terminée"

ssl:
	@certbot renew --nginx --quiet
	@docker compose restart nginx
	@echo "✅ Certificats SSL renouvelés"

clean:
	@docker system prune -f
	@echo "✅ Nettoyage terminé"
