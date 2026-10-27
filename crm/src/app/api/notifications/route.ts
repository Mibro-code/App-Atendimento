import { NextRequest, NextResponse } from "next/server";
import type { NotificationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";

const TYPES: NotificationType[] = ["GOAL_WARNING", "GOAL_ACHIEVED", "GOAL_EXPIRED", "QUOTE_CREATED"];

export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;

  const onlyUnread = req.nextUrl.searchParams.get("unread") === "1";
  // Filtro opcional por tipo (ex.: popup de cotações do supervisor).
  const typeParam = req.nextUrl.searchParams.get("type");
  const type = TYPES.find((t) => t === typeParam);

  const notifications = await prisma.notification.findMany({
    where: { recipientId: user.id, ...(onlyUnread ? { readAt: null } : {}), ...(type ? { type } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ notifications });
}
