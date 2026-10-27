import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "up" });
  } catch (error) {
    return NextResponse.json(
      { status: "error", db: "down", message: (error as Error).message },
      { status: 503 }
    );
  }
}
