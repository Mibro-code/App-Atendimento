import db from "../db.server";
import {
  AppProxyShopError,
  authenticateAppProxyShop,
} from "../services/app-proxy-auth.server";
import fs from "node:fs/promises";
import path from "node:path";

import { requestClientIp } from "../services/public-cnpj-policy.server";
import {
  WholesaleDocumentGenerationError,
  generateFinalDocumentFiles,
} from "../services/wholesale-document-generation.server";
import { listWholesaleOrders } from "../services/wholesale-order-read.server";
import {
  listWholesalePurchasedProducts,
  listWholesaleResources,
} from "../services/wholesale-profile-read.server";
import {
  WholesalePortalAuthError,
  changeWholesalePortalPassword,
  loginWholesalePortal,
  logoutWholesalePortal,
  requireWholesalePortalSession,
} from "../services/wholesale-portal-auth.server";
import { formatCnpj } from "../utils/cnpj";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

// Uma vez nesses status, o documento nao pode mais ser editado pelo
// revendedor. REJECTED fica de fora de proposito: apos uma rejeicao, o
// proximo save_document_draft abre um novo rascunho para reenvio.
const FINALIZED_LOCKED_STATUSES = ["PENDING_APPROVAL", "COMPLETED", "APPROVED"];
const DOCUMENT_STORAGE_DIR = "/app/storage/wholesale-documents";

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...JSON_HEADERS, ...init.headers },
  });
}

function errorResponse(error) {
  if (
    error instanceof WholesalePortalAuthError ||
    error instanceof AppProxyShopError ||
    error instanceof WholesaleDocumentGenerationError
  ) {
    return json(
      { ok: false, code: error.code, message: error.message },
      { status: error.status || 422 },
    );
  }

  console.error("Wholesale portal error", error);
  return json(
    { ok: false, code: "WHOLESALE_PORTAL_ERROR", message: "Nao foi possivel concluir a solicitacao." },
    { status: 500 },
  );
}

function formLoginSuccess(result) {
  const serializedToken = JSON.stringify(result.token).replace(/</g, "\\u003c");
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Entrando no portal</title></head><body><p>Entrando no Portal do Revendedor...</p><script>sessionStorage.setItem("mibro_wholesale_portal_token",${serializedToken});location.replace("/apps/cnpj-validator/portal-revendedor");</script></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

function formLoginError(error) {
  const message = String(error?.message || "Nao foi possivel entrar no portal.")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Acesso nao autorizado</title><style>body{font-family:Arial,sans-serif;max-width:560px;margin:70px auto;padding:24px;color:#202020}a{color:#d62b20;font-weight:700}</style></head><body><h1>Nao foi possivel entrar</h1><p>${message}</p><p><a href="/">Voltar para a loja</a></p></body></html>`,
    { status: error?.status || 401, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

async function portalData(request, shop) {
  const { customer, memberships, companyIds } =
    await requireWholesalePortalSession(request, shop);

  const [orders, products, resources] = await Promise.all([
    listWholesaleOrders({
      shop,
      companyIds,
      limit: 100,
    }),

    listWholesalePurchasedProducts({
      shop,
      companyIds,
    }),

    listWholesaleResources({
      shop,
      companyIds,
      customerId: customer.id,
    }),
  ]);

  const resourceIds = resources.map((resource) => resource.id);

const submissions = resourceIds.length
  ? await db.wholesaleDocumentSubmission.findMany({
      where: {
        shop,
        customerId: customer.id,
        companyId: { in: companyIds },
        resourceId: { in: resourceIds },
      },
      orderBy: {
        updatedAt: "desc",
      },
    })
  : [];

const submissionsByResource = new Map();

for (const submission of submissions) {
  if (!submissionsByResource.has(submission.resourceId)) {
    submissionsByResource.set(submission.resourceId, submission);
  }
}

const resourcesWithSubmissions = resources.map((resource) => ({
  ...resource,
  submission: submissionsByResource.get(resource.id) || null,
})); 

  return {
    ok: true,
    customer: { id: customer.id, name: customer.name, email: customer.email },
    mustChangePassword: customer.credential?.mustChangePassword ?? false,
    companies: memberships.map(({ company, role }) => ({
      id: company.id,
      legalName: company.legalName,
      tradeName: company.tradeName,
      cnpj: company.cnpj,
      formattedCnpj: formatCnpj(company.cnpj),
      role,
      lastSyncedAt: company.lastSyncedAt,
    })),
    orders,
    products,
    resources: resourcesWithSubmissions,
  };
}

const DOWNLOAD_CONTENT_TYPES = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

// So libera download do documento final apos aprovacao/conclusao - durante
// PENDING_APPROVAL o arquivo ja existe (para o admin revisar), mas ainda nao
// e liberado ao revendedor.
async function downloadFinalDocument(request, shop, url) {
  const { customer, companyIds } = await requireWholesalePortalSession(request, shop);
  const submissionId = String(url.searchParams.get("submissionId") || "").trim();
  const kind = String(url.searchParams.get("kind") || "").trim();

  if (!submissionId || !DOWNLOAD_CONTENT_TYPES[kind]) {
    return json({ ok: false, message: "Solicitacao de download invalida." }, { status: 400 });
  }

  const submission = await db.wholesaleDocumentSubmission.findFirst({
    where: {
      id: submissionId,
      shop,
      customerId: customer.id,
      companyId: { in: companyIds },
      status: { in: ["COMPLETED", "APPROVED"] },
    },
    include: { resource: { select: { title: true } } },
  });

  const relativePath = kind === "pdf" ? submission?.finalPdfPath : submission?.finalDocxPath;
  if (!submission || !relativePath) {
    return json({ ok: false, message: "Documento nao disponivel para download." }, { status: 404 });
  }

  const absolutePath = path.join(DOCUMENT_STORAGE_DIR, relativePath);
  let fileBuffer;
  try {
    fileBuffer = await fs.readFile(absolutePath);
  } catch {
    return json({ ok: false, message: "Arquivo nao encontrado no servidor." }, { status: 404 });
  }

  const safeTitle = (submission.resource?.title || "documento")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "documento";

  return new Response(fileBuffer, {
    headers: {
      "Content-Type": DOWNLOAD_CONTENT_TYPES[kind],
      "Content-Disposition": `attachment; filename="${safeTitle}.${kind}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function loader({ request }) {
  try {
    const shop = await authenticateAppProxyShop(request);
    const url = new URL(request.url);
    const portalAction = url.searchParams.get("portal_action");

    if (portalAction === "data") {
      return json(await portalData(request, shop));
    }

    if (portalAction === "download") {
      return downloadFinalDocument(request, shop, url);
    }

    return new Response(PORTAL_LIQUID, {
      headers: {
        "Content-Type": "application/liquid; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function action({ request }) {
  let submittedByThemeForm = false;

  try {
    const shop = await authenticateAppProxyShop(request);
    const contentType = request.headers.get("Content-Type") || "";
    let payload;

    if (contentType.includes("application/json")) {
      payload = await request.json().catch(() => ({}));
    } else {
      submittedByThemeForm = true;
      const formData = await request.formData();
      payload = {
        action: "login",
        identifier: formData.get("identifier"),
        password: formData.get("password"),
      };
    }

    if (payload.action === "login") {
      const result = await loginWholesalePortal({
        shop,
        identifier: payload.identifier,
        password: payload.password,
        clientIp: requestClientIp(request),
      });
      if (submittedByThemeForm) return formLoginSuccess(result);
      return json({
        ok: true,
        token: result.token,
        expiresAt: result.expiresAt,
        mustChangePassword: result.mustChangePassword,
      });
    }

    if (payload.action === "change_password") {
      await changeWholesalePortalPassword({
        request,
        shop,
        newPassword: String(payload.newPassword || ""),
      });
      return json({ ok: true });
    }
    if (payload.action === "save_document_draft") {
      const { customer, companyIds } =
        await requireWholesalePortalSession(request, shop);
      const resourceId = String(payload.resourceId || "").trim();
      const companyId = String(payload.companyId || "").trim();

      if (!resourceId) {
        return json(
          { ok: false, message: "Documento nao informado." },
          { status: 400 },
        );
      }

      if (!companyId || !companyIds.includes(companyId)) {
        return json(
          { ok: false, message: "Empresa invalida para este documento." },
          { status: 400 },
        );
      }

      const resource = await db.wholesaleResource.findFirst({
        where: {
          id: resourceId,
          shop,
          active: true,
          deliveryType: "FILLABLE_DOCUMENT",
          AND: [
            { OR: [{ companyId: null }, { companyId }] },
            {
              OR: [
                { recipients: { none: {} } },
                { recipients: { some: { customerId: customer.id } } },
              ],
            },
          ],
        },
        select: {
          id: true,
          templateVersion: true,
          allowDraft: true,
        },
      });

      if (!resource) {
        return json(
          {
            ok: false,
            message: "Documento nao encontrado ou sem permissao.",
          },
          { status: 404 },
        );
      }

      if (!resource.allowDraft) {
        return json(
          { ok: false, message: "Este documento nao permite salvar rascunho." },
          { status: 400 },
        );
      }

      const lockedSubmission = await db.wholesaleDocumentSubmission.findFirst({
        where: {
          shop,
          resourceId,
          companyId,
          customerId: customer.id,
          status: { in: FINALIZED_LOCKED_STATUSES },
        },
        select: { id: true },
      });

      if (lockedSubmission) {
        return json(
          {
            ok: false,
            code: "WHOLESALE_DOCUMENT_ALREADY_FINALIZED",
            message: "Este documento ja foi finalizado e nao pode mais ser editado.",
          },
          { status: 409 },
        );
      }

      const documentData =
        payload.formData && typeof payload.formData === "object"
          ? payload.formData
          : {};
      const existing = await db.wholesaleDocumentSubmission.findFirst({
        where: {
          shop,
          resourceId,
          companyId,
          customerId: customer.id,
          status: "DRAFT",
        },
        orderBy: { updatedAt: "desc" },
      });
      const submission = existing
        ? await db.wholesaleDocumentSubmission.update({
            where: { id: existing.id },
            data: {
              formData: documentData,
              templateVersion: resource.templateVersion,
            },
          })
        : await db.wholesaleDocumentSubmission.create({
            data: {
              shop,
              resourceId,
              companyId,
              customerId: customer.id,
              status: "DRAFT",
              templateVersion: resource.templateVersion,
              formData: documentData,
            },
          });

      return json({
        ok: true,
        submission: {
          id: submission.id,
          status: submission.status,
          updatedAt: submission.updatedAt,
          formData: submission.formData,
        },
      });
    }

    if (payload.action === "finalize_document") {
      const { customer, companyIds } =
        await requireWholesalePortalSession(request, shop);
      const resourceId = String(payload.resourceId || "").trim();
      const companyId = String(payload.companyId || "").trim();

      if (!resourceId) {
        return json(
          { ok: false, message: "Documento nao informado." },
          { status: 400 },
        );
      }

      if (!companyId || !companyIds.includes(companyId)) {
        return json(
          { ok: false, message: "Empresa invalida para este documento." },
          { status: 400 },
        );
      }

      const resource = await db.wholesaleResource.findFirst({
        where: {
          id: resourceId,
          shop,
          active: true,
          deliveryType: "FILLABLE_DOCUMENT",
          AND: [
            { OR: [{ companyId: null }, { companyId }] },
            {
              OR: [
                { recipients: { none: {} } },
                { recipients: { some: { customerId: customer.id } } },
              ],
            },
          ],
        },
        select: {
          id: true,
          title: true,
          templatePath: true,
          templateVersion: true,
          generatePdf: true,
          requiresApproval: true,
        },
      });

      if (!resource) {
        return json(
          {
            ok: false,
            message: "Documento nao encontrado ou sem permissao.",
          },
          { status: 404 },
        );
      }

      const lockedSubmission = await db.wholesaleDocumentSubmission.findFirst({
        where: {
          shop,
          resourceId,
          companyId,
          customerId: customer.id,
          status: { in: FINALIZED_LOCKED_STATUSES },
        },
        select: { id: true },
      });

      if (lockedSubmission) {
        return json(
          {
            ok: false,
            code: "WHOLESALE_DOCUMENT_ALREADY_FINALIZED",
            message: "Este documento ja foi finalizado e nao pode mais ser editado.",
          },
          { status: 409 },
        );
      }

      const documentData =
        payload.formData && typeof payload.formData === "object"
          ? payload.formData
          : {};

      // Salva o rascunho com os dados mais recentes antes de gerar o
      // documento final, para nao perder o preenchimento caso a geracao
      // falhe (modelo ausente, PDF indisponivel etc.).
      const existingDraft = await db.wholesaleDocumentSubmission.findFirst({
        where: {
          shop,
          resourceId,
          companyId,
          customerId: customer.id,
          status: "DRAFT",
        },
        orderBy: { updatedAt: "desc" },
      });
      const draftSubmission = existingDraft
        ? await db.wholesaleDocumentSubmission.update({
            where: { id: existingDraft.id },
            data: { formData: documentData, templateVersion: resource.templateVersion },
          })
        : await db.wholesaleDocumentSubmission.create({
            data: {
              shop,
              resourceId,
              companyId,
              customerId: customer.id,
              status: "DRAFT",
              templateVersion: resource.templateVersion,
              formData: documentData,
            },
          });

      const generated = await generateFinalDocumentFiles({
        resource,
        submission: draftSubmission,
        formData: documentData,
        customer,
      });

      const finalStatus = resource.requiresApproval
        ? "PENDING_APPROVAL"
        : "COMPLETED";
      const submittedAt = new Date();
      const submission = await db.wholesaleDocumentSubmission.update({
        where: { id: draftSubmission.id },
        data: {
          status: finalStatus,
          submittedAt,
          finalDocxPath: generated.finalDocxPath,
          finalPdfPath: generated.finalPdfPath,
        },
      });

      return json({
        ok: true,
        submission: {
          id: submission.id,
          status: submission.status,
          updatedAt: submission.updatedAt,
          submittedAt: submission.submittedAt,
          formData: submission.formData,
          finalDocxPath: submission.finalDocxPath,
          finalPdfPath: submission.finalPdfPath,
        },
        generatePdf: resource.generatePdf,
        requiresApproval: resource.requiresApproval,
      });
    }
    if (payload.action === "logout") {
      await logoutWholesalePortal(request, shop);
      return json({ ok: true });
    }

    return json(
      { ok: false, code: "WHOLESALE_ACTION_INVALID", message: "Acao invalida." },
      { status: 400 },
    );
  } catch (error) {
    if (submittedByThemeForm) return formLoginError(error);
    return errorResponse(error);
  }
}

const PORTAL_LIQUID = String.raw`
<style>
  .mibro-portal{--red:#f04424;--red-dark:#d93619;--ink:#171513;--muted:#716c67;--line:#e9e5e1;--soft:#f7f5f2;max-width:1240px;margin:28px auto 72px;padding:0 20px;color:var(--ink);font-family:Inter,Arial,sans-serif}
  .mibro-portal *{box-sizing:border-box}.mibro-portal button,.mibro-portal input{font:inherit}
  .mibro-login{max-width:470px;margin:64px auto;padding:38px;border:1px solid var(--line);border-radius:24px;background:#fff;box-shadow:0 24px 70px rgba(35,25,18,.12)}
  .mibro-brand{display:flex;align-items:center;gap:12px;margin-bottom:24px}.mibro-mark{width:44px;height:44px;border-radius:14px;background:linear-gradient(145deg,#ff6442,var(--red-dark));color:#fff;display:grid;place-items:center;font-weight:900;box-shadow:0 9px 22px rgba(240,68,36,.25)}.mibro-brand strong{font-size:20px;letter-spacing:-.02em}
  .mibro-login h1{font-size:30px;letter-spacing:-.035em;margin:0 0 8px}.mibro-sub{color:var(--muted);line-height:1.55;margin:0 0 24px}
  .mibro-field{display:grid;gap:7px;margin:0 0 16px}.mibro-field label{font-size:13px;font-weight:750}.mibro-field input{width:100%;min-height:50px;border:1px solid #d8d2cd;border-radius:12px;padding:12px 14px;background:#fcfbfa;transition:.2s}.mibro-field input:focus{outline:3px solid rgba(240,68,36,.14);border-color:var(--red);background:#fff}
  .mibro-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:11px;min-height:46px;padding:11px 18px;background:linear-gradient(135deg,#fb5938,var(--red-dark));color:#fff;font-weight:800;cursor:pointer;box-shadow:0 7px 16px rgba(240,68,36,.18);transition:transform .18s,box-shadow .18s}.mibro-btn:hover{transform:translateY(-1px);box-shadow:0 10px 22px rgba(240,68,36,.25)}.mibro-btn:disabled{opacity:.55;cursor:wait;transform:none}.mibro-btn--dark{background:#211f1d;box-shadow:none}.mibro-btn--ghost{background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.18);box-shadow:none}
  .mibro-alert{display:none;margin:14px 0;padding:13px 14px;border-radius:10px;background:#fff0ed;color:#9d2715;line-height:1.45}.mibro-alert[data-show=true]{display:block}
  .mibro-shell{display:none;border-radius:26px;background:linear-gradient(180deg,#f4f1ed 0,#faf9f7 340px);box-shadow:0 22px 70px rgba(38,28,20,.08);overflow:hidden}.mibro-shell[data-show=true]{display:block}
  .mibro-top{position:relative;display:flex;justify-content:space-between;gap:24px;align-items:center;padding:38px 40px 64px;background:radial-gradient(circle at 82% 15%,rgba(240,68,36,.28),transparent 27%),linear-gradient(125deg,#171513,#2c2824);color:#fff;overflow:hidden}.mibro-top:after{content:"";position:absolute;right:-55px;bottom:-105px;width:270px;height:270px;border:1px solid rgba(255,255,255,.08);border-radius:50%}
  .mibro-eyebrow{display:flex;align-items:center;gap:8px;margin-bottom:10px;color:#ffaf9d;font-size:11px;font-weight:850;letter-spacing:.16em;text-transform:uppercase}.mibro-eyebrow:before{content:"";width:26px;height:2px;border-radius:99px;background:var(--red)}.mibro-top h1{font-size:34px;letter-spacing:-.04em;margin:0;color:#fff}.mibro-company{color:#d5d0cc;margin-top:8px;font-size:15px}.mibro-actions{position:relative;z-index:1;display:flex;gap:10px;flex-wrap:wrap}
  .mibro-content{padding:0 32px 34px}.mibro-stats{position:relative;z-index:2;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:-32px 0 24px}.mibro-stat{position:relative;min-height:116px;padding:21px 21px 18px;border:1px solid rgba(226,220,214,.9);border-radius:16px;background:rgba(255,255,255,.97);box-shadow:0 9px 28px rgba(42,30,20,.07);overflow:hidden}.mibro-stat:before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:var(--stat,#f04424)}.mibro-stat small{display:block;color:var(--muted);font-size:12px;font-weight:650;margin-bottom:12px}.mibro-stat strong{font-size:27px;letter-spacing:-.035em}.mibro-stat:nth-child(2){--stat:#f3a11a}.mibro-stat:nth-child(3){--stat:#7468d7}.mibro-stat:nth-child(4){--stat:#278b64}
  .mibro-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(300px,.78fr);gap:20px}.mibro-card{border:1px solid var(--line);border-radius:17px;background:#fff;padding:23px;margin-bottom:20px;box-shadow:0 5px 18px rgba(44,33,25,.035)}.mibro-card__head{display:flex;align-items:center;gap:11px;margin-bottom:18px}.mibro-card__icon{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#fff0eb;color:var(--red);font-size:16px;font-weight:900}.mibro-card h2{font-size:18px;letter-spacing:-.02em;margin:0}
  .mibro-list{display:grid;gap:10px}.mibro-row{display:grid;grid-template-columns:1fr auto;gap:16px;padding:15px 2px;border-top:1px solid var(--line)}.mibro-row:first-child{border-top:0}.mibro-row p{margin:5px 0 0;color:var(--muted);font-size:13px}.mibro-badge{display:inline-flex;align-items:center;width:max-content;padding:5px 9px;border-radius:999px;background:#f1efed;color:#55504b;font-size:10px;font-weight:850;text-transform:uppercase;letter-spacing:.035em}
  .mibro-profile-name{padding:15px;border-radius:13px;background:linear-gradient(135deg,#fff3ef,#fff9f6);border:1px solid #f7ded5;margin-bottom:15px}.mibro-profile-name strong{display:block;font-size:17px}.mibro-profile-name span{display:block;color:var(--muted);font-size:12px;margin-top:4px}.mibro-profile-list{margin:0}.mibro-profile-item{display:grid;gap:3px;padding:11px 1px;border-top:1px solid var(--line)}.mibro-profile-item:first-child{border-top:0}.mibro-profile-item dt{color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}.mibro-profile-item dd{margin:0;font-size:13px;line-height:1.45;overflow-wrap:anywhere}
  .mibro-resource{position:relative;display:block;padding:15px 42px 15px 15px;border:1px solid var(--line);border-radius:12px;background:#fff;text-decoration:none;color:inherit;transition:border-color .18s,transform .18s,box-shadow .18s}.mibro-resource:after{content:"↗";position:absolute;right:15px;top:16px;color:var(--red);font-weight:900}.mibro-resource:hover{border-color:#f6aa98;transform:translateY(-1px);box-shadow:0 7px 18px rgba(42,30,20,.07)}.mibro-resource p{color:var(--muted);font-size:12px;line-height:1.45;margin:5px 0 10px}
  .mibro-empty{display:grid;justify-items:center;text-align:center;padding:28px 14px;color:var(--muted);border:1px dashed #ddd7d1;border-radius:13px;background:#fcfbfa}.mibro-empty__icon{display:grid;place-items:center;width:42px;height:42px;margin-bottom:11px;border-radius:13px;background:#f2efec;color:#837d77;font-size:20px}.mibro-empty strong{color:#3e3935;font-size:14px}.mibro-empty span{max-width:280px;margin-top:5px;font-size:12px;line-height:1.45}.mibro-loading{display:none;text-align:center;padding:70px 20px;color:var(--muted)}.mibro-loading[data-show=true]{display:block}
  .mibro-modal{display:none;position:fixed;inset:0;background:rgba(18,15,13,.7);backdrop-filter:blur(5px);z-index:9999;align-items:center;justify-content:center;padding:20px}.mibro-modal[data-show=true]{display:flex}.mibro-modal__box{width:min(460px,100%);background:#fff;border-radius:20px;padding:30px;box-shadow:0 24px 70px rgba(0,0,0,.25)}
  @media(max-width:850px){.mibro-top{align-items:flex-start;flex-direction:column;padding:32px 28px 60px}.mibro-content{padding:0 20px 26px}.mibro-stats{grid-template-columns:repeat(2,1fr)}.mibro-grid{grid-template-columns:1fr}}
  @media(max-width:520px){.mibro-portal{padding:0 10px;margin-top:14px}.mibro-login{padding:25px;margin:28px auto}.mibro-shell{border-radius:18px}.mibro-top{padding:28px 20px 56px}.mibro-top h1{font-size:28px}.mibro-actions{width:100%}.mibro-actions .mibro-btn{flex:1}.mibro-content{padding:0 12px 20px}.mibro-stats{gap:9px}.mibro-stat{min-height:105px;padding:17px 15px}.mibro-stat strong{font-size:22px}.mibro-card{padding:18px}.mibro-row{grid-template-columns:1fr}}
#mibro-password-form .mibro-btn[type="submit"]{
  display:inline-flex !important;
  align-items:center !important;
  justify-content:center !important;
  min-width:180px !important;
  min-height:48px !important;
  padding:12px 20px !important;
  border:0 !important;
  border-radius:12px !important;
  background:#f04424 !important;
  color:#ffffff !important;
  font-size:14px !important;
  font-weight:800 !important;
  line-height:1 !important;
  opacity:1 !important;
  -webkit-text-fill-color:#ffffff !important;
}

#mibro-password-form .mibro-btn[type="submit"]:disabled{
  opacity:.65 !important;
  color:#ffffff !important;
  -webkit-text-fill-color:#ffffff !important;
}
</style>

<div class="mibro-portal" id="mibro-portal">
  <section class="mibro-login" id="mibro-login">
    <div class="mibro-brand"><span class="mibro-mark">M</span><strong>Mibro Empresas</strong></div>
    <h1>Portal do Revendedor</h1>
    <p class="mibro-sub">Acesse pedidos, entregas, produtos, contratos e materiais da sua empresa.</p>
    <form id="mibro-login-form" method="post">
      <div class="mibro-field"><label for="mibro-identifier">CNPJ ou e-mail</label><input id="mibro-identifier" name="identifier" autocomplete="username" required></div>
      <div class="mibro-field"><label for="mibro-password">Senha</label><input id="mibro-password" name="password" type="password" autocomplete="current-password" required></div>
      <button class="mibro-btn" type="submit">Entrar no portal</button>
      <div class="mibro-alert" id="mibro-login-error" role="alert"></div>
    </form>
  </section>

  <div class="mibro-loading" id="mibro-loading" data-show="false">Carregando sua empresa...</div>
  <section class="mibro-shell" id="mibro-shell" data-show="false">
    <header class="mibro-top"><div><div class="mibro-eyebrow">Central B2B Mibro</div><h1>Portal do Revendedor</h1><div class="mibro-company" id="mibro-company"></div></div><div class="mibro-actions"><button class="mibro-btn mibro-btn--ghost" id="mibro-change">Alterar senha</button><button class="mibro-btn mibro-btn--dark" id="mibro-logout">Sair</button></div></header>
    <div class="mibro-content"><div class="mibro-stats" id="mibro-stats"></div>
    <div class="mibro-grid"><main><section class="mibro-card"><div class="mibro-card__head"><span class="mibro-card__icon">↗</span><h2>Pedidos e entregas</h2></div><div class="mibro-list" id="mibro-orders"></div></section><section class="mibro-card"><div class="mibro-card__head"><span class="mibro-card__icon">□</span><h2>Produtos comprados</h2></div><div class="mibro-list" id="mibro-products"></div></section></main><aside><section class="mibro-card"><div class="mibro-card__head"><span class="mibro-card__icon">●</span><h2>Dados da empresa</h2></div><div id="mibro-profile"></div></section><section class="mibro-card"><div class="mibro-card__head"><span class="mibro-card__icon">≡</span><h2>Contratos e manuais</h2></div><div class="mibro-list" id="mibro-resources"></div></section></aside></div></div>
  </section>
</div>

<div class="mibro-modal" id="mibro-password-modal" data-show="false"><div class="mibro-modal__box"><h2>Crie sua nova senha</h2><p class="mibro-sub">Use pelo menos 12 caracteres. A senha temporaria deixara de funcionar.</p><form id="mibro-password-form" method="post"><div class="mibro-field"><label for="mibro-new-password">Nova senha</label><input id="mibro-new-password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></div><div class="mibro-field"><label for="mibro-confirm-password">Confirmar nova senha</label><input id="mibro-confirm-password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></div><div class="mibro-actions"><button class="mibro-btn" type="submit">Confirmar nova senha</button><button class="mibro-btn mibro-btn--ghost" type="button" id="mibro-password-cancel">Cancelar</button></div><div class="mibro-alert" id="mibro-password-error" role="alert"></div></form></div></div>
<div class="mibro-modal" id="mibro-document-modal" data-show="false">
  <div class="mibro-modal__box" style="width:min(920px,100%);max-height:90vh;overflow:auto">
    <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:20px">
      <div>
        <h2 id="mibro-document-title" style="margin:0 0 6px">Documento</h2>
        <p class="mibro-sub" style="margin:0">
          Preencha as informacoes abaixo. Voce podera salvar e continuar depois.
        </p>
      </div>

      <button
        class="mibro-btn mibro-btn--dark"
        type="button"
        id="mibro-document-close"
      >
        Fechar
      </button>

<span
  id="mibro-document-save-status"
  style="
    display:none;
    align-items:center;
    color:#278b64;
    font-size:13px;
    font-weight:700;
  "
></span>

    </div>

    <div class="mibro-alert" id="mibro-document-error" role="alert"></div>

    <form id="mibro-document-form" method="post">
      <input type="hidden" id="mibro-document-resource-id">

      <div class="mibro-field">
        <label for="mibro-doc-legal-name">Razao social</label>
        <input id="mibro-doc-legal-name" type="text">
      </div>

      <div class="mibro-field">
        <label for="mibro-doc-cnpj">CNPJ</label>
        <input id="mibro-doc-cnpj" type="text">
      </div>

      <div class="mibro-field">
        <label for="mibro-doc-responsible">Responsavel</label>
        <input id="mibro-doc-responsible" type="text">
      </div>

      <div class="mibro-field">
        <label for="mibro-doc-email">E-mail</label>
        <input id="mibro-doc-email" type="email">
      </div>

      <div class="mibro-field">
        <label for="mibro-doc-phone">Telefone / WhatsApp</label>
        <input id="mibro-doc-phone" type="text">
      </div>

      <div class="mibro-field">
        <label for="mibro-doc-address">Endereco</label>
        <input id="mibro-doc-address" type="text">
      </div>

      <div class="mibro-field">
        <label for="mibro-doc-cep">CEP</label>
        <input id="mibro-doc-cep" type="text">
      </div>

      <div style="margin-top:26px">
        <h3 style="margin:0 0 10px">Estoque preexistente</h3>
        <p class="mibro-sub">
          Adicione os produtos que fazem parte desta autorizacao.
        </p>

        <div id="mibro-document-products"></div>

        <button
          class="mibro-btn mibro-btn--dark"
          type="button"
          id="mibro-document-add-product"
          style="margin-top:12px"
        >
          + Adicionar produto
        </button>
      </div>

      <div style="margin-top:24px;padding-top:18px;border-top:1px solid var(--line)">
        <strong>
          Total de unidades:
          <span id="mibro-document-total">0</span>
        </strong>
      </div>

      <div class="mibro-actions" style="margin-top:24px">
        <button
          class="mibro-btn mibro-btn--dark"
          type="button"
          id="mibro-document-save"
        >
          Salvar rascunho
        </button>

        <button
          class="mibro-btn"
          type="submit"
        >
          Revisar documento
        </button>
      </div>
    </form>
  </div>
</div>
<div
  class="mibro-modal"
  id="mibro-document-review-modal"
  data-show="false"
>
  <div
    class="mibro-modal__box"
    style="
      width:min(980px,100%);
      max-height:90vh;
      overflow:auto;
    "
  >
    <div
      style="
        display:flex;
        justify-content:space-between;
        gap:16px;
        align-items:flex-start;
        margin-bottom:24px;
      "
    >
      <div>
        <div class="mibro-eyebrow">REVISÃO</div>

        <h2 style="margin:0 0 6px">
          Revise o documento
        </h2>

        <p class="mibro-sub" style="margin:0">
          Confira todos os dados antes de finalizar o documento.
        </p>
      </div>

      <button
        class="mibro-btn mibro-btn--dark"
        type="button"
        id="mibro-document-review-close"
      >
        Fechar
      </button>
    </div>

    <div
      class="mibro-alert"
      id="mibro-document-review-error"
      role="alert"
    ></div>

    <div id="mibro-document-review-content"></div>

    <div
      class="mibro-actions"
      style="
        margin-top:26px;
        padding-top:20px;
        border-top:1px solid var(--line);
      "
    >
      <button
        class="mibro-btn mibro-btn--dark"
        type="button"
        id="mibro-document-review-back"
      >
        Voltar e editar
      </button>

      <button
        class="mibro-btn"
        type="button"
        id="mibro-document-finalize"
      >
        Finalizar documento
      </button>
    </div>
  </div>
</div>
<script>
(()=>{"use strict";
  const key="mibro_wholesale_portal_token";let token=sessionStorage.getItem(key)||"";let data=null;
  const $=id=>document.getElementById(id);const money=(v,c="BRL")=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:c||"BRL"}).format(Number(v)||0);const date=v=>v?new Intl.DateTimeFormat("pt-BR").format(new Date(v)):"Nao informado";const esc=v=>String(v??"").replace(/[&<>\"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#39;"}[m]));
  async function api(options={}){const headers={Accept:"application/json",...(options.body?{"Content-Type":"application/json"}:{}),...(token?{Authorization:"Bearer "+token}:{})};const url=options.data?location.pathname+"?portal_action=data":location.pathname;const response=await fetch(url,{method:options.method||"GET",headers,body:options.body?JSON.stringify(options.body):undefined});const payload=await response.json().catch(()=>null);if(!response.ok||!payload?.ok){const error=new Error(payload?.message||"Nao foi possivel carregar o portal.");error.code=payload?.code;throw error}return payload}
  function alertBox(id,message){const el=$(id);el.textContent=message||"";el.dataset.show=message?"true":"false"}
  function showLogin(){token="";sessionStorage.removeItem(key);$("mibro-login").style.display="block";$("mibro-shell").dataset.show="false";$("mibro-loading").dataset.show="false"}
  function showPassword(required=false){$("mibro-password-modal").dataset.show="true";$("mibro-password-cancel").style.display=required?"none":"inline-flex"}
  function closePassword(){$("mibro-password-modal").dataset.show="false";alertBox("mibro-password-error","");$("mibro-password-form").reset()}
  const empty=(icon,title,text)=>'<div class="mibro-empty"><span class="mibro-empty__icon">'+icon+'</span><strong>'+title+'</strong><span>'+text+'</span></div>';
  const resourceType=type=>({CONTRACT:"Contrato",MANUAL:"Manual",CATALOG:"Catalogo",POLICY:"Politica",OTHER:"Material"}[type]||"Material");

  async function downloadFinalDocument(submissionId, kind, title, button){
    if (button) { button.disabled = true; }
    try {
      const response = await fetch(
        location.pathname + "?portal_action=download&submissionId=" + encodeURIComponent(submissionId) + "&kind=" + kind,
        { headers: token ? { Authorization: "Bearer " + token } : {} },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Nao foi possivel baixar o documento.");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = (title || "documento") + "." + kind;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    } catch (error) {
      alert(error.message || "Nao foi possivel baixar o documento.");
    } finally {
      if (button) { button.disabled = false; }
    }
  }

  function fillableDocumentCard(r){
    const submission = r.submission;
    const status = submission?.status || "DRAFT";
    const safeTitle = esc(r.title);
    const description = r.description ? '<p>'+esc(r.description)+'</p>' : '<p>Documento preenchivel pelo portal.</p>';
    const badge = '<span class="mibro-badge">'+esc(resourceType(r.type))+'</span>';

    if (status === "PENDING_APPROVAL") {
      return '<div class="mibro-resource">'
        +'<strong>'+safeTitle+'</strong>'+description+badge
        +'<span class="mibro-badge" style="margin-left:6px;background:#fff4df;color:#7b4c00">Aguardando aprovacao</span>'
        +(submission.submittedAt ? '<p style="margin-top:8px">Enviado em '+esc(date(submission.submittedAt))+'</p>' : '')
        +'</div>';
    }

    if (status === "COMPLETED" || status === "APPROVED") {
      const downloads = [];
      if (submission.finalPdfPath) {
        downloads.push('<button class="mibro-btn mibro-document-download" type="button" data-submission-id="'+esc(submission.id)+'" data-kind="pdf" data-title="'+safeTitle+'">Baixar PDF</button>');
      }
      if (r.allowDownload && submission.finalDocxPath) {
        downloads.push('<button class="mibro-btn mibro-btn--ghost mibro-document-download" type="button" data-submission-id="'+esc(submission.id)+'" data-kind="docx" data-title="'+safeTitle+'">Baixar DOCX</button>');
      }
      return '<div class="mibro-resource">'
        +'<strong>'+safeTitle+'</strong>'+description+badge
        +'<span class="mibro-badge" style="margin-left:6px;background:#e3f1df;color:#1b5e20">Finalizado</span>'
        +(submission.submittedAt ? '<p style="margin-top:8px">Finalizado em '+esc(date(submission.submittedAt))+'</p>' : '')
        +(downloads.length ? '<div class="mibro-actions" style="margin-top:12px">'+downloads.join("")+'</div>' : '')
        +'</div>';
    }

    const isRejected = status === "REJECTED";
    return '<div class="mibro-resource">'
      +'<strong>'+safeTitle+'</strong>'+description+badge
      +(isRejected ? '<span class="mibro-badge" style="margin-left:6px;background:#fff0ed;color:#9d2715">Rejeitado - reenvie o documento</span>' : '')
      +'<div style="margin-top:12px">'
      +'<button class="mibro-btn mibro-document-open" type="button" data-resource-id="'+esc(r.id)+'">'+(isRejected?"Preencher novamente":"Preencher documento")+'</button>'
      +'</div>'
      +'</div>';
  }

  function render(){const company=data.companies?.[0];$("mibro-company").textContent=company?(company.tradeName||company.legalName):"Mibro Empresas";const total=data.orders.reduce((s,o)=>s+(Number(o.total)||0),0);const transit=data.orders.filter(o=>o.trackingCode&&!/entreg/i.test(o.deliveryStatus||"")).length;$("mibro-stats").innerHTML='<div class="mibro-stat"><small>Pedidos realizados</small><strong>'+data.orders.length+'</strong></div><div class="mibro-stat"><small>Em transporte</small><strong>'+transit+'</strong></div><div class="mibro-stat"><small>Produtos diferentes</small><strong>'+data.products.length+'</strong></div><div class="mibro-stat"><small>Total comprado</small><strong>'+money(total)+'</strong></div>';
    $("mibro-profile").innerHTML=company?'<div class="mibro-profile-name"><strong>'+esc(company.tradeName||company.legalName)+'</strong><span>'+esc(company.legalName)+'</span></div><dl class="mibro-profile-list"><div class="mibro-profile-item"><dt>CNPJ</dt><dd>'+esc(company.formattedCnpj)+'</dd></div><div class="mibro-profile-item"><dt>Responsavel</dt><dd>'+esc(data.customer.name||"Nao informado")+'</dd></div><div class="mibro-profile-item"><dt>E-mail</dt><dd>'+esc(data.customer.email||"Nao informado")+'</dd></div><div class="mibro-profile-item"><dt>Ultima sincronizacao</dt><dd>'+esc(date(company.lastSyncedAt))+'</dd></div></dl>':empty("!","Empresa nao vinculada","Entre em contato com a equipe Mibro para concluir o cadastro.");
    $("mibro-orders").innerHTML=data.orders.length?data.orders.slice(0,20).map(o=>'<div class="mibro-row"><div><strong>Pedido '+esc(o.orderNumber)+'</strong><p>'+esc(date(o.orderedAt))+' · '+esc(o.itemCount)+' item(ns)'+(o.trackingCode?' · Rastreio '+esc(o.trackingCode):'')+'</p></div><div><span class="mibro-badge">'+esc(o.deliveryStatus||o.fulfillmentStatus||o.status||"Processando")+'</span><p>'+money(o.total,o.currencyCode)+'</p></div></div>').join(""):empty("↗","Nenhum pedido por aqui","Quando os pedidos forem sincronizados com o Olist, eles aparecerao nesta area.");
    $("mibro-products").innerHTML=data.products.length?data.products.slice(0,30).map(p=>'<div class="mibro-row"><div><strong>'+esc(p.productName)+'</strong><p>SKU: '+esc(p.sku||"Nao informado")+' · '+esc(p.orderCount)+' pedido(s)</p></div><div><span class="mibro-badge">'+esc(p.totalQuantity)+' un.</span></div></div>').join(""):empty("□","Nenhum produto sincronizado","Seu historico de produtos comprados sera organizado aqui.");
    $("mibro-resources").innerHTML=data.resources.length
  ? data.resources.map(r=>{
      if(r.deliveryType==="FILLABLE_DOCUMENT"){
        return fillableDocumentCard(r);
      }

      return '<a class="mibro-resource" href="'+esc(r.url||"#")+'" target="_blank" rel="noopener">'
        +'<strong>'+esc(r.title)+'</strong>'
        +(r.description?'<p>'+esc(r.description)+'</p>':'<p>Abrir documento</p>')
        +'<span class="mibro-badge">'+esc(resourceType(r.type))+'</span>'
        +'</a>';
    }).join("")
  : empty("≡","Nenhum material disponivel","Contratos, manuais e documentos destinados a voce aparecerao aqui.");
    $("mibro-login").style.display="none";$("mibro-loading").dataset.show="false";$("mibro-shell").dataset.show="true";if(data.mustChangePassword)showPassword(true)
  }
  let activeDocumentResourceId = null;
  let activeReviewPayload = null;

  function documentProductRow(product = {}) {
    const model = esc(product.model || "");
    const quantity = esc(product.quantity || "");
    const serialNumbers = esc(product.serialNumbers || "");
    const notes = esc(product.notes || "");

    return '<div class="mibro-document-product-row" style="display:grid;grid-template-columns:1.2fr .55fr 1fr 1fr auto;gap:10px;align-items:end;margin-bottom:10px">'
      +'<div class="mibro-field" style="margin:0">'
        +'<label>Modelo</label>'
        +'<input class="mibro-doc-product-model" type="text" value="'+model+'" placeholder="Ex.: GS Pro 2">'
      +'</div>'
      +'<div class="mibro-field" style="margin:0">'
        +'<label>Quantidade</label>'
        +'<input class="mibro-doc-product-quantity" type="number" min="1" step="1" value="'+quantity+'" placeholder="0">'
      +'</div>'
      +'<div class="mibro-field" style="margin:0">'
        +'<label>SN / Faixa de SN</label>'
        +'<input class="mibro-doc-product-sn" type="text" value="'+serialNumbers+'" placeholder="Ex.: 0001-0010">'
      +'</div>'
      +'<div class="mibro-field" style="margin:0">'
        +'<label>Observacoes</label>'
        +'<input class="mibro-doc-product-notes" type="text" value="'+notes+'" placeholder="Opcional">'
      +'</div>'
      +'<button class="mibro-btn mibro-btn--dark mibro-document-remove-product" type="button" style="min-height:50px">'
        +'Remover'
      +'</button>'
    +'</div>';
  }

  function updateDocumentTotal() {
    const quantities = document.querySelectorAll(".mibro-doc-product-quantity");

    let total = 0;

    quantities.forEach(input => {
      total += Number(input.value) || 0;
    });

    $("mibro-document-total").textContent = String(total);
  }

  function addDocumentProduct(product = {}) {
    $("mibro-document-products").insertAdjacentHTML(
      "beforeend",
      documentProductRow(product)
    );

    updateDocumentTotal();
  }

  function closeDocumentModal() {
    $("mibro-document-modal").dataset.show = "false";
    activeDocumentResourceId = null;
    alertBox("mibro-document-error", "");
  }

  function openDocumentModal(resourceId) {
    const resource = data.resources.find(r => r.id === resourceId);
    const company = data.companies?.[0];

    if (!resource) {
      return alertBox(
        "mibro-document-error",
        "Documento nao encontrado."
      );
    }

    if (["PENDING_APPROVAL", "COMPLETED", "APPROVED"].includes(resource.submission?.status)) {
      return alertBox(
        "mibro-document-error",
        "Este documento ja foi finalizado e nao pode mais ser editado."
      );
    }

    activeDocumentResourceId = resourceId;

    $("mibro-document-resource-id").value = resource.id;
    $("mibro-document-title").textContent = resource.title || "Documento";

   const draft = resource.submission?.formData || null;

$("mibro-doc-legal-name").value =
  draft?.company?.legalName ||
  company?.legalName ||
  "";

$("mibro-doc-cnpj").value =
  draft?.company?.cnpj ||
  company?.formattedCnpj ||
  company?.cnpj ||
  "";

$("mibro-doc-responsible").value =
  draft?.company?.responsible ||
  data.customer?.name ||
  "";

$("mibro-doc-email").value =
  draft?.company?.email ||
  data.customer?.email ||
  "";

$("mibro-doc-phone").value =
  draft?.company?.phone || "";

$("mibro-doc-address").value =
  draft?.company?.address || "";

$("mibro-doc-cep").value =
  draft?.company?.cep || "";

$("mibro-document-products").innerHTML = "";

if (draft?.products?.length) {
  draft.products.forEach(product => {
    addDocumentProduct(product);
  });
} else {
  addDocumentProduct();
}

updateDocumentTotal();

    $("mibro-document-modal").dataset.show = "true";
  }

  function collectDocumentFormData() {
    const products = [...document.querySelectorAll(".mibro-document-product-row")]
      .map(row => ({
        model: row.querySelector(".mibro-doc-product-model")?.value.trim() || "",
        quantity: Number(
          row.querySelector(".mibro-doc-product-quantity")?.value
        ) || 0,
        serialNumbers:
          row.querySelector(".mibro-doc-product-sn")?.value.trim() || "",
        notes:
          row.querySelector(".mibro-doc-product-notes")?.value.trim() || "",
      }))
      .filter(product =>
        product.model ||
        product.quantity ||
        product.serialNumbers ||
        product.notes
      );

    return {
      resourceId: activeDocumentResourceId,
companyId: data.companies?.[0]?.id || null,
      company: {
        legalName: $("mibro-doc-legal-name").value.trim(),
        cnpj: $("mibro-doc-cnpj").value.trim(),
        responsible: $("mibro-doc-responsible").value.trim(),
        email: $("mibro-doc-email").value.trim(),
        phone: $("mibro-doc-phone").value.trim(),
        address: $("mibro-doc-address").value.trim(),
        cep: $("mibro-doc-cep").value.trim(),
      },

      products,

      totalQuantity: products.reduce(
        (sum, product) => sum + (Number(product.quantity) || 0),
        0
      ),
    };
  }



function openDocumentReview(payload) {
  const reviewModal = $("mibro-document-review-modal");
  const reviewContent = $("mibro-document-review-content");

  if (!reviewModal || !reviewContent) return;

  activeReviewPayload = payload;

  const company = payload.company || {};
  const products = Array.isArray(payload.products)
    ? payload.products
    : [];

  let productRows = "";

  if (products.length) {
    productRows = products.map((product, index) =>
      '<div style="padding:16px;border:1px solid var(--line);border-radius:12px;margin-bottom:12px;background:#fff;">' +
        '<strong style="display:block;margin-bottom:10px;">Produto ' +
          esc(index + 1) +
        '</strong>' +

        '<div style="display:grid;gap:7px;font-size:13px;">' +

          '<div><strong>Modelo:</strong> ' +
            esc(product.model || "Nao informado") +
          '</div>' +

          '<div><strong>Quantidade:</strong> ' +
            esc(product.quantity || 0) +
          '</div>' +

          '<div><strong>Numeros de serie:</strong> ' +
            esc(product.serialNumbers || "Nao informado") +
          '</div>' +

          '<div><strong>Observacoes:</strong> ' +
            esc(product.notes || "Nenhuma") +
          '</div>' +

        '</div>' +
      '</div>'
    ).join("");
  } else {
    productRows =
      '<div class="mibro-empty">Nenhum produto informado.</div>';
  }

  reviewContent.innerHTML =
    '<section style="padding:18px;border:1px solid var(--line);border-radius:14px;margin-bottom:20px;background:#fcfbfa;">' +

      '<h3 style="margin:0 0 14px;">Dados da empresa</h3>' +

      '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 20px;font-size:13px;">' +

        '<div><strong>Razao social</strong><br>' +
          esc(company.legalName || "Nao informado") +
        '</div>' +

        '<div><strong>CNPJ</strong><br>' +
          esc(company.cnpj || "Nao informado") +
        '</div>' +

        '<div><strong>Responsavel</strong><br>' +
          esc(company.responsible || "Nao informado") +
        '</div>' +

        '<div><strong>E-mail</strong><br>' +
          esc(company.email || "Nao informado") +
        '</div>' +

        '<div><strong>Telefone</strong><br>' +
          esc(company.phone || "Nao informado") +
        '</div>' +

        '<div><strong>CEP</strong><br>' +
          esc(company.cep || "Nao informado") +
        '</div>' +

        '<div style="grid-column:1 / -1;"><strong>Endereco</strong><br>' +
          esc(company.address || "Nao informado") +
        '</div>' +

      '</div>' +
    '</section>' +

    '<section>' +

      '<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:14px;">' +
        '<h3 style="margin:0;">Produtos</h3>' +
        '<span class="mibro-badge">Total: ' +
          esc(payload.totalQuantity || 0) +
          ' un.</span>' +
      '</div>' +

      productRows +

    '</section>';

  $("mibro-document-modal").dataset.show = "false";
  reviewModal.dataset.show = "true";
}


  async function load(){if(!token)return showLogin();$("mibro-login").style.display="none";$("mibro-loading").dataset.show="true";try{data=await api({data:true});render()}catch(error){showLogin();alertBox("mibro-login-error",error.message)}}
  $("mibro-login-form").addEventListener("submit",async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;alertBox("mibro-login-error","");try{const result=await api({method:"POST",body:{action:"login",identifier:$("mibro-identifier").value,password:$("mibro-password").value}});token=result.token;sessionStorage.setItem(key,token);await load()}catch(error){alertBox("mibro-login-error",error.message)}finally{button.disabled=false}});
  $("mibro-password-form").addEventListener("submit",async event=>{event.preventDefault();const first=$("mibro-new-password").value,second=$("mibro-confirm-password").value;if(first!==second)return alertBox("mibro-password-error","As senhas nao coincidem.");const button=event.submitter;button.disabled=true;try{await api({method:"POST",body:{action:"change_password",newPassword:first}});closePassword();data.mustChangePassword=false}catch(error){alertBox("mibro-password-error",error.message)}finally{button.disabled=false}});
  document.addEventListener("click", event => {
    const openButton = event.target.closest(".mibro-document-open");

    if (openButton) {
      openDocumentModal(openButton.dataset.resourceId);
      return;
    }

    const downloadButton = event.target.closest(".mibro-document-download");

    if (downloadButton) {
      downloadFinalDocument(
        downloadButton.dataset.submissionId,
        downloadButton.dataset.kind,
        downloadButton.dataset.title,
        downloadButton,
      );
      return;
    }

    const removeButton = event.target.closest(".mibro-document-remove-product");

    if (removeButton) {
      const row = removeButton.closest(".mibro-document-product-row");

      if (row) row.remove();

      if (!$("mibro-document-products").children.length) {
        addDocumentProduct();
      }

      updateDocumentTotal();
    }
  });

  document.addEventListener("input", event => {
    if (event.target.classList.contains("mibro-doc-product-quantity")) {
      updateDocumentTotal();
    }
  });

  $("mibro-document-close").addEventListener("click", closeDocumentModal);

  $("mibro-document-add-product").addEventListener("click", () => {
    addDocumentProduct();
  });

$("mibro-document-save").addEventListener("click", async event => {
  const button = event.currentTarget;
  const payload = collectDocumentFormData();

  if (!payload.resourceId || !payload.companyId) {
    return alertBox(
      "mibro-document-error",
      "Nao foi possivel identificar o documento ou a empresa."
    );
  }

  button.disabled = true;
  button.textContent = "Salvando...";

  alertBox("mibro-document-error", "");

  try {
    const result = await api({
      method: "POST",
      body: {
        action: "save_document_draft",
        resourceId: payload.resourceId,
        companyId: payload.companyId,
        formData: payload,
      },
    });

    const resource = data.resources.find(
      item => item.id === payload.resourceId
    );

    if (resource) {
      resource.submission = result.submission;
    }

    button.textContent = "Rascunho salvo";

const saveStatus = $("mibro-document-save-status");

if (saveStatus) {
  saveStatus.style.display = "inline-flex";
  saveStatus.textContent =
    "✓ Rascunho salvo às " +
    new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
}

    setTimeout(() => {
      button.textContent = "Salvar rascunho";
    }, 1800);
  } catch (error) {
    alertBox(
      "mibro-document-error",
      error.message || "Nao foi possivel salvar o rascunho."
    );

    button.textContent = "Salvar rascunho";
  } finally {
    button.disabled = false;
  }
});

 $("mibro-document-form").addEventListener("submit", event => {
  event.preventDefault();

  const payload = collectDocumentFormData();

  alertBox("mibro-document-error", "");

  openDocumentReview(payload);
});

$("mibro-document-review-close")?.addEventListener(
  "click",
  () => {
    $("mibro-document-review-modal").dataset.show = "false";
  }
);

$("mibro-document-review-back")?.addEventListener(
  "click",
  () => {
    $("mibro-document-review-modal").dataset.show = "false";
    $("mibro-document-modal").dataset.show = "true";
  }
);

$("mibro-document-finalize")?.addEventListener(
  "click",
  async event => {
    if (!activeReviewPayload) return;

    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Finalizando...";
    alertBox("mibro-document-review-error", "");

    try {
      const result = await api({
        method: "POST",
        body: {
          action: "finalize_document",
          resourceId: activeReviewPayload.resourceId,
          companyId: activeReviewPayload.companyId,
          formData: activeReviewPayload,
        },
      });

      const resource = data.resources.find(
        item => item.id === activeReviewPayload.resourceId
      );
      if (resource) {
        resource.submission = result.submission;
      }

      $("mibro-document-review-modal").dataset.show = "false";
      $("mibro-document-modal").dataset.show = "false";
      activeReviewPayload = null;
      render();
    } catch (error) {
      alertBox(
        "mibro-document-review-error",
        error.message || "Nao foi possivel finalizar o documento."
      );
    } finally {
      button.disabled = false;
      button.textContent = "Finalizar documento";
    }
  }
);
 
 $("mibro-change").addEventListener("click",()=>showPassword(false));$("mibro-password-cancel").addEventListener("click",closePassword);$("mibro-logout").addEventListener("click",async()=>{try{await api({method:"POST",body:{action:"logout"}})}catch{}showLogin()});load();
})();
</script>`;
