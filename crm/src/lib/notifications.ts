import "server-only";
import { prisma } from "@/lib/prisma";
import type { NotificationType, Prisma } from "@prisma/client";

interface CreateNotificationInput {
  recipientId: string;
  type: NotificationType;
  title: string;
  message: string;
  goalId?: string;
  quoteId?: string;
  dedupeKey: string;
}

/**
 * Ponto único de criação de Notification. `dedupeKey` é único no banco
 * (mesmo padrão de FollowUp.dedupeKey) — upsert com update vazio garante que
 * chamar isto duas vezes para o mesmo evento nunca duplica o aviso, mesmo em
 * corrida entre dois syncs concorrentes.
 */
export async function notifyOnce(input: CreateNotificationInput) {
  const data: Prisma.NotificationCreateInput = {
    recipient: { connect: { id: input.recipientId } },
    type: input.type,
    title: input.title,
    message: input.message,
    dedupeKey: input.dedupeKey,
    ...(input.goalId ? { goal: { connect: { id: input.goalId } } } : {}),
    ...(input.quoteId ? { quote: { connect: { id: input.quoteId } } } : {}),
  };
  await prisma.notification.upsert({
    where: { dedupeKey: input.dedupeKey },
    update: {},
    create: data,
  });
}
