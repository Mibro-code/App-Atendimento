-- CreateEnum
CREATE TYPE "EarlyDepartureReason" AS ENUM ('COMPROMISSO', 'EMERGENCIA', 'PROBLEMA_PESSOAL', 'AUTORIZACAO_SUPERVISOR', 'OUTRO');

-- CreateEnum
CREATE TYPE "OccurrenceType" AS ENUM ('ATRASO', 'SAIDA_ANTECIPADA', 'FALTA', 'PROBLEMA_NO_PONTO', 'ESQUECIMENTO', 'ATESTADO', 'OUTRO');

-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "TimeClockEarlyDeparture" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expectedAt" TIMESTAMP(3) NOT NULL,
    "actualAt" TIMESTAMP(3) NOT NULL,
    "reason" "EarlyDepartureReason" NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeClockEarlyDeparture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Occurrence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "OccurrenceType" NOT NULL,
    "occurrenceDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Occurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceDocument" (
    "id" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeClockCorrection" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "fieldChanged" TEXT NOT NULL,
    "oldValue" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeClockCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TimeClockEarlyDeparture_entryId_key" ON "TimeClockEarlyDeparture"("entryId");

-- CreateIndex
CREATE INDEX "TimeClockEarlyDeparture_userId_createdAt_idx" ON "TimeClockEarlyDeparture"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Occurrence_userId_idx" ON "Occurrence"("userId");

-- CreateIndex
CREATE INDEX "Occurrence_status_idx" ON "Occurrence"("status");

-- CreateIndex
CREATE INDEX "Occurrence_occurrenceDate_idx" ON "Occurrence"("occurrenceDate");

-- CreateIndex
CREATE INDEX "AttendanceDocument_occurrenceId_idx" ON "AttendanceDocument"("occurrenceId");

-- CreateIndex
CREATE INDEX "TimeClockCorrection_entryId_idx" ON "TimeClockCorrection"("entryId");

-- AddForeignKey
ALTER TABLE "TimeClockEarlyDeparture" ADD CONSTRAINT "TimeClockEarlyDeparture_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "TimeClockEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClockEarlyDeparture" ADD CONSTRAINT "TimeClockEarlyDeparture_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDocument" ADD CONSTRAINT "AttendanceDocument_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "Occurrence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDocument" ADD CONSTRAINT "AttendanceDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClockCorrection" ADD CONSTRAINT "TimeClockCorrection_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "TimeClockEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClockCorrection" ADD CONSTRAINT "TimeClockCorrection_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
