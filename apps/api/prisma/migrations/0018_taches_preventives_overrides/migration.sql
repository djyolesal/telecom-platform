-- CreateEnum
CREATE TYPE "FrequenceTache" AS ENUM ('MENSUELLE', 'TRIMESTRIELLE', 'SEMESTRIELLE', 'AU_BESOIN');

-- CreateTable
CREATE TABLE "taches_preventives_overrides" (
    "key" VARCHAR(40) NOT NULL,
    "libelle" TEXT NOT NULL,
    "frequence" "FrequenceTache" NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "taches_preventives_overrides_pkey" PRIMARY KEY ("key")
);
