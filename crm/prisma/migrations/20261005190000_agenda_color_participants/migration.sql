-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "color" TEXT;

-- CreateTable
CREATE TABLE "AppointmentParticipant" (
    "appointmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentParticipant_pkey" PRIMARY KEY ("appointmentId","userId")
);

-- CreateIndex
CREATE INDEX "AppointmentParticipant_userId_idx" ON "AppointmentParticipant"("userId");

-- AddForeignKey
ALTER TABLE "AppointmentParticipant" ADD CONSTRAINT "AppointmentParticipant_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentParticipant" ADD CONSTRAINT "AppointmentParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
