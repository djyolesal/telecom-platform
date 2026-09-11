-- Référentiel des pièces de rechange (niveau 1 de traçabilité) : normalise la
-- saisie libre du terrain SANS la casser - un APK antérieur continue d'envoyer
-- du texte, le serveur rapproche automatiquement vers le référentiel.
CREATE TABLE IF NOT EXISTS "pieces_ref" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "libelle" VARCHAR(120) NOT NULL,
    "categorie" VARCHAR(20),
    "unite" VARCHAR(20) NOT NULL DEFAULT 'unité',
    "cout_standard" DECIMAL(12,2),
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pieces_ref_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "pieces_ref_code_key" ON "pieces_ref"("code");
COMMENT ON TABLE "pieces_ref" IS 'Catalogue des pièces de rechange - la saisie terrain reste libre, le serveur rapproche.';

ALTER TABLE "pieces_rechange" ADD COLUMN IF NOT EXISTS "piece_ref_id" TEXT;
ALTER TABLE "pieces_rechange" DROP CONSTRAINT IF EXISTS "pieces_rechange_piece_ref_id_fkey";
ALTER TABLE "pieces_rechange" ADD CONSTRAINT "pieces_rechange_piece_ref_id_fkey"
  FOREIGN KEY ("piece_ref_id") REFERENCES "pieces_ref"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "pieces_rechange_piece_ref_id_idx" ON "pieces_rechange"("piece_ref_id");
