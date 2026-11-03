import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, forbidden, notFound } from "@/lib/api-auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;

  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification) return notFound("Notificação não encontrada.");
  if (notification.recipientId !== user.id) return forbidden();

  const updated = await prisma.notification.update({
    where: { id },
    data: { readAt: notification.readAt ?? new Date() },
  });

  return NextResponse.json({ notification: updated });
}
