CREATE TYPE "CustomerInterestedBrand" AS ENUM ('MIBRO', 'SINCROFIT', 'AMBAS');

ALTER TABLE "Customer"
  ALTER COLUMN "interestedBrand" TYPE "CustomerInterestedBrand"
  USING ("interestedBrand"::text::"CustomerInterestedBrand");
