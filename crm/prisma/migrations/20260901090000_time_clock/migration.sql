-- CreateEnum
CREATE TYPE "TimeClockEventType" AS ENUM ('CLOCK_IN', 'LUNCH_START', 'LUNCH_END', 'CLOCK_OUT');

-- CreateTable
CREATE TABLE "TimeClockEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" "TimeClockEventType" NOT NULL,
    "workDate" DATE NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locationStatus" "LocationStatus",
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyMeters" DOUBLE PRECISION,
    "locationCapturedAt" TIMESTAMP(3),
    "userAgentSummary" TEXT,
    "deviceType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeClockEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TimeClockEntry_userId_workDate_eventType_key"
ON "TimeClockEntry"("userId", "workDate", "eventType");

-- CreateIndex
CREATE INDEX "TimeClockEntry_userId_occurredAt_idx"
ON "TimeClockEntry"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "TimeClockEntry_workDate_idx" ON "TimeClockEntry"("workDate");

-- AddForeignKey
ALTER TABLE "TimeClockEntry"
ADD CONSTRAINT "TimeClockEntry_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
