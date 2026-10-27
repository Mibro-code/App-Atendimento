import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { APPOINTMENT_SELECT, getAgendaViewer, toAppointmentDTO } from "@/lib/agenda";
import { isReminderActive } from "@/lib/agenda-rules";

/**
 * Lembretes ativos do PRÓPRIO usuário, exibidos dentro do app (não há
 * infraestrutura de push/e-mail/WhatsApp ainda). Consulta só uma janela curta
 * ao redor de agora — o maior lembrete é "1 dia antes".
 */
export async function GET() {
  const { user, error } = await requireSession();
  if (error) return error;
  const viewer = await getAgendaViewer(user);
  const now = new Date();
  const rows = await prisma.appointment.findMany({
    where: {
      assignedToId: user.id,
      status: "PENDENTE",
      reminderMinutes: { not: null },
      reminderDismissedAt: null,
      startsAt: { gte: new Date(now.getTime() - 2 * 86_400_000), lte: new Date(now.getTime() + 2 * 86_400_000) },
    },
    select: APPOINTMENT_SELECT,
    orderBy: { startsAt: "asc" },
    take: 50,
  });
  const reminders = rows.filter((row) => isReminderActive(row, now)).slice(0, 3).map((row) => toAppointmentDTO(row, viewer));
  return NextResponse.json({ reminders });
}
