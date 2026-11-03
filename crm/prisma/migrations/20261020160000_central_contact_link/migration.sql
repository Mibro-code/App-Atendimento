CREATE TABLE "CentralContactLink" (
    "id" TEXT NOT NULL,
    "attendanceCompanyId" TEXT NOT NULL,
    "attendanceContactId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "confirmedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CentralContactLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CentralContactLink_attendanceCompanyId_attendanceContactId_key" ON "CentralContactLink"("attendanceCompanyId", "attendanceContactId");
CREATE INDEX "CentralContactLink_customerId_idx" ON "CentralContactLink"("customerId");
ALTER TABLE "CentralContactLink" ADD CONSTRAINT "CentralContactLink_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
