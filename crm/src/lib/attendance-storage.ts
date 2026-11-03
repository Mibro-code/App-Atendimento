import "server-only";
import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export {
  validateAttendanceDocument,
  validateAttendanceDocumentContent,
  isAllowedExtension,
} from "./attendance-document-validation";
export type { AttendanceDocumentValidationError } from "./attendance-document-validation";

// Armazenamento de documentos de ocorrência (atestados) em disco local — não
// há S3/blob configurado neste projeto. Fica fora de "public/" de propósito
// (nunca servido estaticamente); todo acesso passa pela rota autenticada
// /api/attendance-documents/[id], que reconfere RBAC a cada request.
//
// Em dev (docker-compose.dev.yml) o projeto inteiro é bind-mounted, então
// este diretório persiste sem configuração extra. Em produção
// (docker-compose.yml, imagem standalone) um volume nomeado é montado neste
// mesmo caminho.
export const ATTENDANCE_DOCUMENTS_DIR =
  process.env.ATTENDANCE_DOCUMENTS_DIR || path.join(process.cwd(), "storage", "attendance-documents");

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

/**
 * Grava o arquivo em disco com nome aleatório (nunca o nome enviado pelo
 * cliente — evita path traversal e colisão) e retorna a storageKey a salvar
 * em AttendanceDocument.storageKey.
 */
export async function saveAttendanceDocumentFile(buffer: Buffer, mimeType: string): Promise<string> {
  await mkdir(ATTENDANCE_DOCUMENTS_DIR, { recursive: true });
  const extension = MIME_TO_EXTENSION[mimeType] || "bin";
  const storageKey = `${crypto.randomUUID()}.${extension}`;
  await writeFile(path.join(ATTENDANCE_DOCUMENTS_DIR, storageKey), buffer);
  return storageKey;
}

export async function readAttendanceDocumentFile(storageKey: string): Promise<Buffer> {
  // storageKey é sempre gerado por crypto.randomUUID() nesta camada (nunca
  // aceito do cliente na leitura) — basename() é só defesa em profundidade
  // contra um storageKey malformado alcançar aqui por outra via.
  const safeName = path.basename(storageKey);
  return readFile(path.join(ATTENDANCE_DOCUMENTS_DIR, safeName));
}
