import { NextRequest, NextResponse } from "next/server";
import { requireSession, badRequest, forbidden, notFound } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { canUseTimeClock } from "@/lib/time-clock";
import {
  isAllowedExtension,
  saveAttendanceDocumentFile,
  validateAttendanceDocument,
  validateAttendanceDocumentContent,
} from "@/lib/attendance-storage";

// Upload de anexo (atestado) numa ocorrência do PRÓPRIO usuário — nunca em
// ocorrência de outro usuário, mesmo que o id seja adivinhado.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (!canUseTimeClock(user.role)) return forbidden("Disponível somente para vendedores e supervisores.");

  const { id } = await params;
  const occurrence = await prisma.occurrence.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!occurrence) return notFound("Ocorrência não encontrada.");
  if (occurrence.userId !== user.id) return forbidden("Você só pode anexar documentos às suas próprias ocorrências.");

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) return badRequest("Nenhum arquivo enviado.");

  const validationError = validateAttendanceDocument({ type: file.type, size: file.size });
  if (validationError) return badRequest(validationError.message, { code: validationError.code });
  if (!isAllowedExtension(file.name)) {
    return badRequest("Extensão de arquivo não aceita. Envie JPG, PNG ou PDF.", {
      code: "INVALID_EXTENSION",
    });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentError = validateAttendanceDocumentContent(buffer, file.type);
  if (contentError) return badRequest(contentError.message, { code: contentError.code });
  const storageKey = await saveAttendanceDocumentFile(buffer, file.type);

  const document = await prisma.attendanceDocument.create({
    data: {
      occurrenceId: occurrence.id,
      userId: user.id,
      fileName: file.name || "documento",
      mimeType: file.type,
      fileSize: file.size,
      storageKey,
    },
    select: { id: true, fileName: true, mimeType: true, fileSize: true, uploadedAt: true },
  });

  return NextResponse.json({ document }, { status: 201 });
}
