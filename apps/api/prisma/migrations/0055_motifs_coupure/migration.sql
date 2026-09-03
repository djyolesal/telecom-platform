CREATE TABLE "motifs_coupure" (
    "id" TEXT NOT NULL,
    "champ" VARCHAR(10) NOT NULL,
    "libelle" VARCHAR(150) NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "motifs_coupure_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "motifs_coupure_champ_libelle_key" ON "motifs_coupure"("champ", "libelle");
COMMENT ON TABLE "motifs_coupure" IS 'Formulations types suggérées à la saisie NOC (cause/actions de coupure) - la frappe libre reste possible.';
