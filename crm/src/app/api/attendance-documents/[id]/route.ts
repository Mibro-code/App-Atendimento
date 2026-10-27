import { NextRequest, NextResponse } from "next/server";
import { requireSession, forbidden, notFound } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { getVisibleSellerIds } from "@/lib/authz";
import { readAttendanceDocumentFile } from "@/lib/attendance-storage";

// Nunca servido de "public/" — todo acesso passa por aqui e reconfere RBAC a
// cada request (dono do documento, supervisor da própria equipe, ou admin),
// mesmo que o id seja conhecido/adivinhado.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSession();
  if (error) return error;

  const { id } = await params;
  const document = await prisma.attendanceDocument.findUnique({
    where: { id },
    select: { fileName: true, mimeType: true, storageKey: true, userId: true },
  });
  if (!document) return notFound("Documento não encontrado.");

  const visibleIds = await getVisibleSellerIds(user);
  const allowed = visibleIds === null || visibleIds.includes(document.userId);
  if (!allowed) return forbidden("Você não tem acesso a este documento.");

  let buffer: Buffer;
  try {
    buffer = await readAttendanceDocumentFile(document.storageKey);
  } catch {
    return notFound("Arquivo não encontrado no armazenamento.");
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(document.fileName)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
