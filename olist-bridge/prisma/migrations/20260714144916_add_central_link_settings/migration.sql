-- CreateTable
CREATE TABLE "CentralLinkSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "warrantyUrl" TEXT NOT NULL DEFAULT '/pages/garantia',
    "appUrl" TEXT NOT NULL DEFAULT '/pages/aplicativo-fit',
    "supportUrl" TEXT NOT NULL DEFAULT '/pages/contato',
    "installationGuideUrl" TEXT NOT NULL DEFAULT '/pages/guias-de-instalacao',
    "warrantyRequestUrl" TEXT NOT NULL DEFAULT '/pages/garantia',
    "contactSupportUrl" TEXT NOT NULL DEFAULT '/pages/contato',
    "policiesUrl" TEXT NOT NULL DEFAULT '/pages/politicas',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);
