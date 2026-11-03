import fs from "node:fs/promises";
import path from "node:path";

import db from "../db.server";
import { authenticate } from "../shopify.server";

const STORAGE_DIR = "/app/storage/wholesale-documents";
const CONTENT_TYPES = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

// Permite que a equipe Mibro visualize/baixe o documento gerado (inclusive
// enquanto ainda esta PENDING_APPROVAL, para poder decidir aprovar ou
// rejeitar) usando a sessao normal do admin embutido da Shopify.
export async function loader({ request, params }) {
  const { session } = await authenticate.admin(request);
  const { submissionId, kind } = params;

  if (!CONTENT_TYPES[kind]) {
    throw new Response("Formato invalido.", { status: 400 });
  }

  const submission = await db.wholesaleDocumentSubmission.findFirst({
    where: { id: submissionId, shop: session.shop },
    include: { resource: { select: { title: true } } },
  });

  const relativePath = kind === "pdf" ? submission?.finalPdfPath : submission?.finalDocxPath;
  if (!submission || !relativePath) {
    throw new Response("Documento nao encontrado.", { status: 404 });
  }

  let fileBuffer;
  try {
    fileBuffer = await fs.readFile(path.join(STORAGE_DIR, relativePath));
  } catch {
    throw new Response("Arquivo nao encontrado no servidor.", { status: 404 });
  }

  const safeTitle = (submission.resource?.title || "documento")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "documento";

  return new Response(fileBuffer, {
    headers: {
      "Content-Type": CONTENT_TYPES[kind],
      "Content-Disposition": `inline; filename="${safeTitle}.${kind}"`,
      "Cache-Control": "no-store",
    },
  });
}
