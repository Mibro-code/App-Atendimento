import {
  ALLOWED_ATTENDANCE_DOCUMENT_EXTENSIONS,
  ALLOWED_ATTENDANCE_DOCUMENT_MIME_TYPES,
  MAX_ATTENDANCE_DOCUMENT_SIZE_BYTES,
} from "./config";

// Validação pura (sem Node/fs) separada de attendance-storage.ts de
// propósito: attendance-storage.ts é "server-only" (grava/lê disco), mas
// essa validação precisa ser testável em unit test (vitest não resolve
// "server-only" fora do build do Next).

export interface AttendanceDocumentValidationError {
  code: "INVALID_TYPE" | "INVALID_EXTENSION" | "INVALID_CONTENT" | "TOO_LARGE" | "EMPTY";
  message: string;
}

/** Valida MIME (whitelist) e tamanho. Nunca confia só na extensão do nome enviado pelo cliente. */
export function validateAttendanceDocument(file: {
  type: string;
  size: number;
}): AttendanceDocumentValidationError | null {
  if (!file.size) return { code: "EMPTY", message: "Arquivo vazio." };
  if (file.size > MAX_ATTENDANCE_DOCUMENT_SIZE_BYTES) {
    return { code: "TOO_LARGE", message: "Arquivo maior que o limite de 10 MB." };
  }
  if (!ALLOWED_ATTENDANCE_DOCUMENT_MIME_TYPES.includes(file.type as (typeof ALLOWED_ATTENDANCE_DOCUMENT_MIME_TYPES)[number])) {
    return { code: "INVALID_TYPE", message: "Tipo de arquivo não aceito. Envie JPG, PNG ou PDF." };
  }
  return null;
}

export function isAllowedExtension(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return (ALLOWED_ATTENDANCE_DOCUMENT_EXTENSIONS as readonly string[]).includes(ext);
}

/** Confere a assinatura real do arquivo, sem confiar apenas no MIME enviado pelo navegador. */
export function validateAttendanceDocumentContent(
  bytes: Uint8Array,
  mimeType: string
): AttendanceDocumentValidationError | null {
  const startsWith = (signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);

  const valid =
    (mimeType === "image/jpeg" && startsWith([0xff, 0xd8, 0xff])) ||
    (mimeType === "image/png" && startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (mimeType === "application/pdf" && startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]));

  return valid
    ? null
    : { code: "INVALID_CONTENT", message: "O conteúdo do arquivo não corresponde a um JPG, PNG ou PDF válido." };
}
