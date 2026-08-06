# ── Build stage ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Dépendances natives requises par les engines Prisma sous Alpine (musl)
RUN apk add --no-cache openssl libc6-compat

COPY package*.json ./
COPY prisma ./prisma/
# Liaison internet du serveur parfois instable (ETIMEDOUT vers registry.npmjs.org) :
# retries + timeouts généreux + cache npm persistant entre builds (BuildKit).
RUN --mount=type=cache,target=/root/.npm \
    npm ci --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 --fetch-timeout=300000

COPY . .
RUN npx prisma generate
RUN npm run build
# Compile le seed en JS autonome (les devDeps/types sont disponibles ici)
RUN npm run build:seed

# ── Production stage ──────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Fuseau FIXÉ : sans lui, les dates du rapport NOC (construites avec des
# setters locaux) glissaient selon le fuseau de l'hôte — la clé d'unicité
# de l'import ne matchait plus et le ré-import dupliquait au lieu d'apurer.
ENV TZ=Africa/Lome
ENV NODE_ENV=production

# curl pour le healthcheck ; openssl + libc6-compat pour les engines Prisma
# (migrate + client) ; poppler-utils + tesseract (fra) pour l'analyse des PDF
# de bons de commande (pré-remplissage du formulaire, y compris scans OCR).
RUN apk add --no-cache curl openssl libc6-compat poppler-utils tesseract-ocr tesseract-ocr-data-fra

# Créer utilisateur non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-seed ./dist-seed
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma/
# Prisma 7 : la CLI (désormais en dependencies, plus de téléchargement npx au
# `make migrate`) lit l'URL de connexion dans ce fichier — sans lui, migrate
# deploy échoue dans le conteneur.
COPY prisma.config.ts ./

RUN mkdir -p /app/logs && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Heap borné sous la mem_limit de 1 Go du compose : V8 échoue proprement
# (exception récupérable) au lieu de se faire tuer par Docker (exit 137).
CMD ["node", "--max-old-space-size=700", "dist/server.js"]
