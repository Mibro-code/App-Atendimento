-- Additive visibility control for operational categories.
ALTER TABLE "Category"
ADD COLUMN "masterOnly" BOOLEAN NOT NULL DEFAULT false;

-- The existing TESTE category must start restricted as requested.
UPDATE "Category" SET "masterOnly" = true
WHERE UPPER(TRIM("name")) = 'TESTE' OR UPPER(TRIM("code")) = 'TESTE';

UPDATE "BotTriageOption" SET "enabled" = false
WHERE "categoryId" IN (
  SELECT child."id" FROM "Category" child
  LEFT JOIN "Category" parent ON parent."id" = child."parentId"
  WHERE child."masterOnly" = true OR parent."masterOnly" = true
);
