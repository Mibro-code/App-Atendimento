import db from "../db.server";

const ALLOWED_TYPES = new Set([
  "CONTRACT",
  "MANUAL",
  "CATALOG",
  "POLICY",
  "OTHER",
]);
const ALLOWED_DELIVERY_TYPES = new Set([
  "LINK",
  "FILLABLE_DOCUMENT",
]);

function requiredText(value, label, maxLength = 240) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} e obrigatorio.`);
  if (text.length > maxLength) throw new Error(`${label} e muito longo.`);
  return text;
}

function optionalText(value, maxLength = 500) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.length > maxLength) throw new Error("A descricao e muito longa.");
  return text;
}

function validHttpsUrl(value) {
  const text = requiredText(value, "Link", 2000);
  let url;

  try {
    url = new URL(text);
  } catch {
    throw new Error("Informe um link valido para o arquivo.");
  }

  if (url.protocol !== "https:") {
    throw new Error("O link do arquivo precisa usar HTTPS.");
  }

  return url.toString();
}
function optionalHttpsUrl(value) {
  const text = typeof value === "string" ? value.trim() : "";

  if (!text) return null;

  let url;

  try {
    url = new URL(text);
  } catch {
    throw new Error("Informe um link valido para o arquivo.");
  }

  if (url.protocol !== "https:") {
    throw new Error("O link do arquivo precisa usar HTTPS.");
  }

  return url.toString();
}

function uniqueCustomerIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => String(id || "").trim()).filter(Boolean))];
}

async function validateRecipients({ shop, companyId, customerIds, client = db }) {
  const ids = uniqueCustomerIds(customerIds);
  if (ids.length === 0) return ids;

  const customers = await client.wholesaleCustomer.findMany({
    where: {
      id: { in: ids },
      shop,
      ...(companyId
        ? {
            companies: {
              some: { companyId, active: true, company: { active: true } },
            },
          }
        : {}),
    },
    select: { id: true },
  });

  if (customers.length !== ids.length) {
    throw new Error(
      companyId
        ? "Uma das pessoas nao pertence a empresa selecionada."
        : "Uma das pessoas selecionadas nao pertence a esta loja.",
    );
  }

  return ids;
}

export async function createWholesaleResource({ shop, input }) {
  const type = requiredText(input.type, "Tipo", 30).toUpperCase();
  if (!ALLOWED_TYPES.has(type)) throw new Error("Tipo de material invalido.");
const deliveryType = String(input.deliveryType || "LINK")
  .trim()
  .toUpperCase();

if (!ALLOWED_DELIVERY_TYPES.has(deliveryType)) {
  throw new Error("Forma de material invalida.");
}
  const companyId = optionalText(input.companyId, 100);
  if (companyId) {
    const company = await db.wholesaleCompany.findFirst({
      where: { id: companyId, shop },
      select: { id: true },
    });
    if (!company) throw new Error("Empresa selecionada nao encontrada.");
  }

  return db.$transaction(async (tx) => {
    const customerIds = await validateRecipients({
      shop,
      companyId,
      customerIds: input.customerIds,
      client: tx,
    });

    return tx.wholesaleResource.create({
      data: {
        shop,
        companyId,
        type,
        title: requiredText(input.title, "Titulo"),
        description: optionalText(input.description),
        deliveryType,

url:
  deliveryType === "LINK"
    ? validHttpsUrl(input.url)
    : optionalHttpsUrl(input.url),
templatePath:
  deliveryType === "FILLABLE_DOCUMENT"
    ? optionalText(input.templatePath, 500)
    : null,

templateName:
  deliveryType === "FILLABLE_DOCUMENT"
    ? optionalText(input.templateName, 240)
    : null,
allowDraft:
  deliveryType === "FILLABLE_DOCUMENT"
    ? Boolean(input.allowDraft)
    : false,

allowDownload:
  deliveryType === "FILLABLE_DOCUMENT"
    ? Boolean(input.allowDownload)
    : true,

generatePdf:
  deliveryType === "FILLABLE_DOCUMENT"
    ? Boolean(input.generatePdf)
    : false,

requiresApproval:
  deliveryType === "FILLABLE_DOCUMENT"
    ? Boolean(input.requiresApproval)
    : false,
        displayOrder: Number.isInteger(Number(input.displayOrder))
          ? Number(input.displayOrder)
          : 0,
        recipients: {
          create: customerIds.map((customerId) => ({ customerId })),
        },
      },
    });
  });
}

export async function setWholesaleResourceRecipients({
  shop,
  resourceId,
  customerIds,
}) {
  return db.$transaction(async (tx) => {
    const resource = await tx.wholesaleResource.findFirst({
      where: { id: resourceId, shop },
      select: { id: true, companyId: true },
    });
    if (!resource) throw new Error("Material nao encontrado.");

    const ids = await validateRecipients({
      shop,
      companyId: resource.companyId,
      customerIds,
      client: tx,
    });

    await tx.wholesaleResourceRecipient.deleteMany({
      where: { resourceId: resource.id },
    });
    if (ids.length > 0) {
      await tx.wholesaleResourceRecipient.createMany({
        data: ids.map((customerId) => ({ resourceId: resource.id, customerId })),
      });
    }

    return { count: ids.length };
  });
}

export async function setWholesaleResourceActive({ shop, resourceId, active }) {
  const result = await db.wholesaleResource.updateMany({
    where: { id: resourceId, shop },
    data: { active },
  });

  if (result.count !== 1) throw new Error("Material nao encontrado.");
}

export async function listPendingDocumentSubmissions({ shop }) {
  const submissions = await db.wholesaleDocumentSubmission.findMany({
    where: { shop, status: "PENDING_APPROVAL" },
    include: { resource: { select: { title: true } } },
    orderBy: { submittedAt: "asc" },
  });

  if (submissions.length === 0) return [];

  const companyIds = [...new Set(submissions.map((item) => item.companyId))];
  const customerIds = [...new Set(submissions.map((item) => item.customerId))];

  const [companies, customers] = await Promise.all([
    db.wholesaleCompany.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, legalName: true, tradeName: true, cnpj: true },
    }),
    db.wholesaleCustomer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, name: true, email: true },
    }),
  ]);

  const companyById = new Map(companies.map((company) => [company.id, company]));
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));

  return submissions.map((submission) => {
    const company = companyById.get(submission.companyId);
    const customer = customerById.get(submission.customerId);

    return {
      id: submission.id,
      resourceTitle: submission.resource?.title || "Documento",
      companyName: company?.tradeName || company?.legalName || "",
      companyCnpj: company?.cnpj || "",
      customerName: customer?.name || "",
      customerEmail: customer?.email || "",
      submittedAt: submission.submittedAt,
      hasPdf: Boolean(submission.finalPdfPath),
      hasDocx: Boolean(submission.finalDocxPath),
    };
  });
}

export async function approveDocumentSubmission({ shop, submissionId }) {
  const result = await db.wholesaleDocumentSubmission.updateMany({
    where: { id: submissionId, shop, status: "PENDING_APPROVAL" },
    data: { status: "APPROVED", approvedAt: new Date() },
  });

  if (result.count !== 1) {
    throw new Error("Submissao nao encontrada ou ja processada.");
  }
}

export async function rejectDocumentSubmission({ shop, submissionId }) {
  const result = await db.wholesaleDocumentSubmission.updateMany({
    where: { id: submissionId, shop, status: "PENDING_APPROVAL" },
    data: { status: "REJECTED", rejectedAt: new Date() },
  });

  if (result.count !== 1) {
    throw new Error("Submissao nao encontrada ou ja processada.");
  }
}
