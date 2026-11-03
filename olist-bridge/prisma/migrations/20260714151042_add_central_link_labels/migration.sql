ALTER TABLE "CentralLinkSettings"
ADD COLUMN "warrantyLabel" TEXT NOT NULL DEFAULT 'Garantia',
ADD COLUMN "appLabel" TEXT NOT NULL DEFAULT 'Aplicativo Fit',
ADD COLUMN "supportLabel" TEXT NOT NULL DEFAULT 'Suporte',
ADD COLUMN "installationGuideLabel" TEXT NOT NULL DEFAULT 'Guia de instalação',
ADD COLUMN "warrantyRequestLabel" TEXT NOT NULL DEFAULT 'Acionar garantia',
ADD COLUMN "contactSupportLabel" TEXT NOT NULL DEFAULT 'Falar com suporte',
ADD COLUMN "policiesLabel" TEXT NOT NULL DEFAULT 'Ver políticas da loja';