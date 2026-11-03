ALTER TABLE "AppearanceSettings"
ADD COLUMN "accountBorderWidth" TEXT NOT NULL DEFAULT 'base',
ADD COLUMN "quickCardBorderWidth" TEXT NOT NULL DEFAULT 'base',
ADD COLUMN "orderCardBorderWidth" TEXT NOT NULL DEFAULT 'base',
ADD COLUMN "accountBorderRadius" TEXT NOT NULL DEFAULT 'base',
ADD COLUMN "quickCardBorderRadius" TEXT NOT NULL DEFAULT 'base',
ADD COLUMN "orderCardBorderRadius" TEXT NOT NULL DEFAULT 'base';