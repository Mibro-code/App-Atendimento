import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

const STORAGE_DIR = "/app/storage/wholesale-documents";
const FINAL_DIR = path.join(STORAGE_DIR, "final");
const GOTENBERG_URL = (process.env.GOTENBERG_URL || "").replace(/\/+$/, "");

export class WholesaleDocumentGenerationError extends Error {
  constructor(message, { code = "WHOLESALE_DOCUMENT_GENERATION_ERROR" } = {}) {
    super(message);
    this.name = "WholesaleDocumentGenerationError";
    this.code = code;
  }
}

// Dados disponiveis para o template .docx (merge fields no formato do
// docxtemplater, ex.: {company.legalName}, {#products}{model}{/products}).
function buildTemplateData({ formData, customer, submission, resource }) {
  const company = formData?.company && typeof formData.company === "object" ? formData.company : {};
  const products = Array.isArray(formData?.products) ? formData.products : [];

  return {
    company: {
      legalName: company.legalName || "",
      cnpj: company.cnpj || "",
      responsible: company.responsible || "",
      email: company.email || "",
      phone: company.phone || "",
      address: company.address || "",
      cep: company.cep || "",
    },
    products: products.map((product) => ({
      model: product?.model || "",
      quantity: product?.quantity ?? "",
      serialNumbers: product?.serialNumbers || "",
      notes: product?.notes || "",
    })),
    totalQuantity: formData?.totalQuantity ?? "",
    customerName: customer?.name || "",
    customerEmail: customer?.email || "",
    resourceTitle: resource?.title || "",
    submittedAt: new Date().toLocaleDateString("pt-BR"),
    submissionId: submission?.id || "",
  };
}

async function fillDocxTemplate(templateAbsolutePath, templateData) {
  let templateBuffer;
  try {
    templateBuffer = await fs.readFile(templateAbsolutePath);
  } catch {
    throw new WholesaleDocumentGenerationError(
      "O modelo .docx deste documento nao foi encontrado no servidor.",
      { code: "TEMPLATE_FILE_MISSING" },
    );
  }

  try {
    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });
    doc.render(templateData);
    return doc.getZip().generate({ type: "nodebuffer" });
  } catch (error) {
    const details = Array.isArray(error?.properties?.errors)
      ? error.properties.errors.map((item) => item?.properties?.explanation).filter(Boolean).join("; ")
      : "";
    throw new WholesaleDocumentGenerationError(
      `Nao foi possivel preencher o modelo do documento.${details ? ` Detalhe: ${details}` : ""}`,
      { code: "TEMPLATE_RENDER_FAILED" },
    );
  }
}

async function convertDocxToPdf(docxBuffer, fileName) {
  if (!GOTENBERG_URL) {
    throw new WholesaleDocumentGenerationError(
      "Geracao de PDF nao configurada no servidor.",
      { code: "PDF_CONVERSION_NOT_CONFIGURED" },
    );
  }

  const form = new FormData();
  form.append(
    "files",
    new Blob([docxBuffer], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    fileName,
  );

  let response;
  try {
    response = await fetch(`${GOTENBERG_URL}/forms/libreoffice/convert`, {
      method: "POST",
      body: form,
    });
  } catch {
    throw new WholesaleDocumentGenerationError(
      "Nao foi possivel conectar ao servico de geracao de PDF.",
      { code: "PDF_CONVERSION_UNAVAILABLE" },
    );
  }

  if (!response.ok) {
    throw new WholesaleDocumentGenerationError(
      "O servico de geracao de PDF retornou um erro.",
      { code: "PDF_CONVERSION_FAILED" },
    );
  }

  return Buffer.from(await response.arrayBuffer());
}

// Preenche o modelo, salva o .docx final e, quando exigido pelo material,
// converte e salva o .pdf final. Nao grava nada no banco - apenas gera os
// arquivos e devolve os caminhos relativos para o chamador persistir.
export async function generateFinalDocumentFiles({ resource, submission, formData, customer }) {
  if (!resource.templatePath) {
    throw new WholesaleDocumentGenerationError(
      "Este material nao possui um modelo de documento configurado.",
      { code: "TEMPLATE_NOT_CONFIGURED" },
    );
  }

  const templateData = buildTemplateData({ formData, customer, submission, resource });
  const templateAbsolutePath = path.join(STORAGE_DIR, resource.templatePath);
  const docxBuffer = await fillDocxTemplate(templateAbsolutePath, templateData);

  await fs.mkdir(FINAL_DIR, { recursive: true });

  const baseName = `${submission.id}-${randomUUID().slice(0, 8)}`;
  const docxFileName = `${baseName}.docx`;
  await fs.writeFile(path.join(FINAL_DIR, docxFileName), docxBuffer);

  let pdfFileName = null;
  if (resource.generatePdf) {
    const pdfBuffer = await convertDocxToPdf(docxBuffer, docxFileName);
    pdfFileName = `${baseName}.pdf`;
    await fs.writeFile(path.join(FINAL_DIR, pdfFileName), pdfBuffer);
  }

  return {
    finalDocxPath: path.join("final", docxFileName),
    finalPdfPath: pdfFileName ? path.join("final", pdfFileName) : null,
  };
}

export async function removeFinalDocumentFiles({ finalDocxPath, finalPdfPath }) {
  await Promise.all(
    [finalDocxPath, finalPdfPath]
      .filter(Boolean)
      .map((relativePath) => fs.unlink(path.join(STORAGE_DIR, relativePath)).catch(() => {})),
  );
}
