CREATE TYPE "OrderFollowUpStatus" AS ENUM ('PENDING', 'NOTIFIED', 'RESOLVED');

ALTER TABLE "User"
  ADD COLUMN "timeClockReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "timeClockRequiredEvents" "TimeClockEventType"[] NOT NULL DEFAULT ARRAY['CLOCK_IN', 'CLOCK_OUT']::"TimeClockEventType"[],
  ADD COLUMN "timeClockWorkingDays" INTEGER[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5],
  ADD COLUMN "timeClockStartMinutes" INTEGER NOT NULL DEFAULT 540,
  ADD COLUMN "timeClockLunchStartMinutes" INTEGER NOT NULL DEFAULT 720,
  ADD COLUMN "timeClockLunchEndMinutes" INTEGER NOT NULL DEFAULT 780,
  ADD COLUMN "timeClockEndMinutes" INTEGER NOT NULL DEFAULT 1080,
  ADD COLUMN "timeClockReminderIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "orderFollowUpAssigneeId" TEXT;

ALTER TABLE "User"
  ADD CONSTRAINT "User_orderFollowUpAssigneeId_fkey"
  FOREIGN KEY ("orderFollowUpAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_orderFollowUpAssigneeId_idx" ON "User"("orderFollowUpAssigneeId");

ALTER TABLE "OlistOrder"
  ADD COLUMN "followUpStatus" "OrderFollowUpStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "followUpNotifiedAt" TIMESTAMP(3),
  ADD COLUMN "followUpNotifiedById" TEXT,
  ADD COLUMN "followUpResolvedAt" TIMESTAMP(3),
  ADD COLUMN "followUpResolvedById" TEXT;

ALTER TABLE "OlistOrder"
  ADD CONSTRAINT "OlistOrder_followUpNotifiedById_fkey"
  FOREIGN KEY ("followUpNotifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OlistOrder"
  ADD CONSTRAINT "OlistOrder_followUpResolvedById_fkey"
  FOREIGN KEY ("followUpResolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "OlistOrder_followUpStatus_createdAt_idx" ON "OlistOrder"("followUpStatus", "createdAt");

CREATE TABLE "CommissionPlan" (
  "id" TEXT NOT NULL,
  "representativeId" TEXT NOT NULL,
  "createdById" TEXT,
  "brand" "CommercialBrand",
  "rateBps" INTEGER NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommissionPlan_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "CommissionPlan" ADD CONSTRAINT "CommissionPlan_representativeId_fkey" FOREIGN KEY ("representativeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionPlan" ADD CONSTRAINT "CommissionPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "CommissionPlan_representativeId_startDate_endDate_idx" ON "CommissionPlan"("representativeId", "startDate", "endDate");
CREATE INDEX "CommissionPlan_representativeId_brand_startDate_idx" ON "CommissionPlan"("representativeId", "brand", "startDate");
