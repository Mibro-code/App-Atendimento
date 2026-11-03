ALTER TABLE "User"
ADD COLUMN "canViewUncategorized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canManageCategories" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canTransferConversations" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canViewTeamActivity" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "UserCategoryAccess" (
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserCategoryAccess_pkey" PRIMARY KEY ("userId", "categoryId")
);

CREATE INDEX "UserCategoryAccess_categoryId_idx" ON "UserCategoryAccess"("categoryId");

ALTER TABLE "UserCategoryAccess" ADD CONSTRAINT "UserCategoryAccess_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserCategoryAccess" ADD CONSTRAINT "UserCategoryAccess_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
