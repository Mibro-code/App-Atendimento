ALTER TABLE "User" ADD COLUMN "hideUncategorized" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "UserHiddenCategory" (
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserHiddenCategory_pkey" PRIMARY KEY ("userId", "categoryId")
);

CREATE INDEX "UserHiddenCategory_categoryId_idx" ON "UserHiddenCategory"("categoryId");

ALTER TABLE "UserHiddenCategory" ADD CONSTRAINT "UserHiddenCategory_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserHiddenCategory" ADD CONSTRAINT "UserHiddenCategory_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
