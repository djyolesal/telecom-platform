-- Synonymes d'une pièce du catalogue : d'autres façons dont le terrain l'écrit,
-- rapprochées comme le libellé (casse, accents et séparateurs ignorés). Ils
-- rattachent l'historique ET les saisies à venir - un rattachement fait ligne à
-- ligne en base ne servirait qu'une fois.

ALTER TABLE "pieces_ref" ADD COLUMN "synonymes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Décision de l'exploitant (08/10/2026) : « Batterie 100 Ah » saisie sans tension
-- est la batterie 12V 100 Ah. Posé sur la pièce du catalogue qui la porte (celle
-- de la migration 0074, ou celle saisie à la main avant elle si 0074 l'a sautée).
UPDATE "pieces_ref" SET "synonymes" = ARRAY['Batterie 100 Ah']
WHERE "id" = (
  SELECT "id" FROM "pieces_ref"
  WHERE "code" = 'BATTERIE_12V_100AH'
     OR regexp_replace(lower("libelle"), '[^a-z0-9]', '', 'g') = 'batterie12v100ah'
  ORDER BY ("code" = 'BATTERIE_12V_100AH') DESC, "created_at"
  LIMIT 1
);
