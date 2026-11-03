-- CreateEnum
CREATE TYPE "LocationSource" AS ENUM ('PROPOSAL_STARTED', 'PROPOSAL_SENT', 'CUSTOMER_VISIT');

-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('GRANTED', 'DENIED', 'UNAVAILABLE', 'TIMEOUT', 'NOT_SUPPORTED');

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "sellerEmailSnapshot" TEXT,
ADD COLUMN     "sellerJobTitleSnapshot" TEXT,
ADD COLUMN     "sellerNameSnapshot" TEXT,
ADD COLUMN     "sellerPhoneSnapshot" TEXT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "avatarUrl",
DROP COLUMN "internalNotes",
DROP COLUMN "jobTitle",
DROP COLUMN "monthlyGoalCents",
DROP COLUMN "phone",
DROP COLUMN "region";

-- CreateTable
CREATE TABLE "SellerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "fullName" TEXT,
    "avatarUrl" TEXT,
    "jobTitle" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "commercialEmail" TEXT,
    "commercialPhone" TEXT,
    "emailSenderName" TEXT,
    "emailReplyTo" TEXT,
    "monthlyGoalCents" INTEGER,
    "region" TEXT,
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationCapture" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "customerId" TEXT,
    "quoteId" TEXT,
    "activityId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyMeters" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3),
    "locationStatus" "LocationStatus" NOT NULL,
    "locationSource" "LocationSource" NOT NULL,
    "userAgentSummary" TEXT,
    "deviceType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationCapture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SellerProfile_userId_key" ON "SellerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LocationCapture_activityId_key" ON "LocationCapture"("activityId");

-- CreateIndex
CREATE INDEX "LocationCapture_sellerId_createdAt_idx" ON "LocationCapture"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "LocationCapture_customerId_idx" ON "LocationCapture"("customerId");

-- CreateIndex
CREATE INDEX "LocationCapture_quoteId_idx" ON "LocationCapture"("quoteId");

-- CreateIndex
CREATE INDEX "LocationCapture_locationSource_idx" ON "LocationCapture"("locationSource");

-- AddForeignKey
ALTER TABLE "SellerProfile" ADD CONSTRAINT "SellerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationCapture" ADD CONSTRAINT "LocationCapture_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationCapture" ADD CONSTRAINT "LocationCapture_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationCapture" ADD CONSTRAINT "LocationCapture_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationCapture" ADD CONSTRAINT "LocationCapture_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "CustomerActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

