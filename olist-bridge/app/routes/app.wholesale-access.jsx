import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import db from "../db.server";
import {
  createWholesaleAccess,
  resetWholesaleTemporaryPassword,
  setWholesaleAccessActive,
} from "../services/wholesale-access-admin.server";
import {
  approveDocumentSubmission,
  createWholesaleResource,
  listPendingDocumentSubmissions,
  rejectDocumentSubmission,
  setWholesaleResourceActive,
  setWholesaleResourceRecipients,
} from "../services/wholesale-resource-admin.server";
import { authenticate } from "../shopify.server";
import { formatCnpj } from "../utils/cnpj";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const companies = await db.wholesaleCompany.findMany({
    where: { shop: session.shop },
    include: {
      customers: {
        include: {
          customer: {
            include: {
              credential: {
                select: {
                  mustChangePassword: true,
                  lockedUntil: true,
                  updatedAt: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ legalName: "asc" }],
  });
  const resources = await db.wholesaleResource.findMany({
    where: { shop: session.shop },
    include: {
      company: { select: { legalName: true, tradeName: true } },
      recipients: {
        include: {
          customer: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ displayOrder: "asc" }, { title: "asc" }],
  });

  const accesses = companies.flatMap((company) =>
    company.customers.map(({ customer, role }) => ({
      customerId: customer.id,
      companyId: company.id,
      legalName: company.legalName,
      tradeName: company.tradeName,
      cnpj: company.cnpj,
      olistCustomerId: company.olistCustomerId,
      name: customer.name,
      email: customer.email,
      role,
      active: customer.active,
      mustChangePassword: customer.credential?.mustChangePassword ?? false,
      lockedUntil: customer.credential?.lockedUntil ?? null,
      credentialUpdatedAt: customer.credential?.updatedAt ?? null,
    })),
  );
  const people = [...new Map(
    accesses.map((access) => [
      access.customerId,
      {
        id: access.customerId,
        name: access.name,
        email: access.email,
        company: access.tradeName || access.legalName,
        active: access.active,
      },
    ]),
  ).values()];

  const pendingDocumentSubmissions = await listPendingDocumentSubmissions({
    shop: session.shop,
  });

  return {
    shop: session.shop,
    companies: companies.map((company) => ({
      id: company.id,
      name: company.tradeName || company.legalName,
    })),
    resources,
    accesses,
    people,
    pendingDocumentSubmissions,
  };
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "create") {
      const result = await createWholesaleAccess({
        shop: session.shop,
        input: {
          cnpj: formData.get("cnpj"),
          legalName: formData.get("legalName"),
          tradeName: formData.get("tradeName"),
          olistCustomerId: formData.get("olistCustomerId"),
          name: formData.get("name"),
          email: formData.get("email"),
          temporaryPassword: formData.get("temporaryPassword"),
        },
      });

      return {
        success: true,
        message: "Acesso atacadista criado com sucesso.",
        credentials: {
          email: result.customer.email,
          temporaryPassword: result.temporaryPassword,
          company: result.company.tradeName || result.company.legalName,
        },
      };
    }

    if (intent === "reset-password") {
      const result = await resetWholesaleTemporaryPassword({
        shop: session.shop,
        customerId: String(formData.get("customerId") || ""),
      });

      return {
        success: true,
        message: "Nova senha temporaria gerada.",
        credentials: {
          email: result.customer.email,
          temporaryPassword: result.temporaryPassword,
          company: null,
        },
      };
    }

    if (intent === "set-active") {
      const active = formData.get("active") === "true";
      await setWholesaleAccessActive({
        shop: session.shop,
        customerId: String(formData.get("customerId") || ""),
        active,
      });

      return {
        success: true,
        message: active ? "Acesso reativado." : "Acesso bloqueado.",
      };
    }

   if (intent === "create-resource") {
  const deliveryType = String(formData.get("deliveryType") || "LINK")
    .trim()
    .toUpperCase();

  let templatePath = null;
  let templateName = null;

  if (deliveryType === "FILLABLE_DOCUMENT") {
    const templateFile = formData.get("templateFile");

    if (
      !templateFile ||
      typeof templateFile !== "object" ||
      typeof templateFile.arrayBuffer !== "function" ||
      !templateFile.name
    ) {
      throw new Error("Envie um arquivo .docx para o documento preenchivel.");
    }

    const originalName = String(templateFile.name || "").trim();

    if (!originalName.toLowerCase().endsWith(".docx")) {
      throw new Error("O arquivo modelo precisa estar no formato .docx.");
    }

    const maxSize = 10 * 1024 * 1024;

    if (Number(templateFile.size || 0) > maxSize) {
      throw new Error("O arquivo .docx deve ter no maximo 10 MB.");
    }

    const storageDir = "/app/storage/wholesale-documents";

    await fs.mkdir(storageDir, {
      recursive: true,
    });

    const safeName = originalName
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-");

    const uniqueName = `${Date.now()}-${safeName}`;

    const absolutePath = path.join(storageDir, uniqueName);

    const buffer = Buffer.from(await templateFile.arrayBuffer());

    await fs.writeFile(absolutePath, buffer);

    templatePath = uniqueName;
    templateName = originalName;
  }

  try {
    await createWholesaleResource({
      shop: session.shop,
      input: {
        type: formData.get("type"),
        companyId: formData.get("companyId"),
        title: formData.get("title"),
        description: formData.get("description"),

        deliveryType,

        url: formData.get("url"),

        templatePath,
        templateName,

        allowDraft: formData.get("allowDraft") === "on",
        allowDownload: formData.get("allowDownload") === "on",
        generatePdf: formData.get("generatePdf") === "on",
        requiresApproval: formData.get("requiresApproval") === "on",

        displayOrder: formData.get("displayOrder"),
        customerIds: formData.getAll("customerIds"),
      },
    });
  } catch (error) {
    if (templatePath) {
      await fs
        .unlink(path.join("/app/storage/wholesale-documents", templatePath))
        .catch(() => {});
    }

    throw error;
  }

  return {
    success: true,
    message:
      deliveryType === "FILLABLE_DOCUMENT"
        ? "Documento preenchivel adicionado ao perfil."
        : "Material adicionado ao perfil.",
  };
    }

    if (intent === "set-resource-recipients") {
      const result = await setWholesaleResourceRecipients({
        shop: session.shop,
        resourceId: String(formData.get("resourceId") || ""),
        customerIds: formData.getAll("customerIds"),
      });

      return {
        success: true,
        message: result.count
          ? `Destinatarios atualizados: ${result.count} pessoa(s).`
          : "O material voltou a ser geral dentro do escopo selecionado.",
      };
    }

    if (intent === "set-resource-active") {
      const active = formData.get("active") === "true";
      await setWholesaleResourceActive({
        shop: session.shop,
        resourceId: String(formData.get("resourceId") || ""),
        active,
      });

      return {
        success: true,
        message: active ? "Material exibido no perfil." : "Material ocultado do perfil.",
      };
    }

    if (intent === "approve-document-submission") {
      await approveDocumentSubmission({
        shop: session.shop,
        submissionId: String(formData.get("submissionId") || ""),
      });

      return { success: true, message: "Documento aprovado e liberado ao revendedor." };
    }

    if (intent === "reject-document-submission") {
      await rejectDocumentSubmission({
        shop: session.shop,
        submissionId: String(formData.get("submissionId") || ""),
      });

      return { success: true, message: "Documento rejeitado." };
    }

    return { success: false, message: "Acao nao reconhecida." };
  } catch (error) {
    console.error("[WHOLESALE_ACCESS_ADMIN] Falha na operacao.", {
      shop: session.shop,
      intent,
      message: error.message,
    });

    return {
      success: false,
      message: error.message || "Nao foi possivel concluir a operacao.",
    };
  }
}

function Field({ label, name, type = "text", required, placeholder, help }) {
  return (
    <label className="wholesale-access-field" htmlFor={name}>
      <span>{label}</span>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
      />
      {help ? <small>{help}</small> : null}
    </label>
  );
}

export default function WholesaleAccessPage() {
  const { shop, accesses, companies, resources, people, pendingDocumentSubmissions } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <s-page heading="Acessos Atacado">
      <style>{`
        .wholesale-access-layout { display:grid; gap:20px; padding-bottom:48px; }
        .wholesale-access-card { padding:24px; border:1px solid #e1e3e5; border-radius:14px; background:#fff; }
        .wholesale-access-card h2, .wholesale-access-card h3 { margin:0 0 6px; }
        .wholesale-access-muted { margin:0; color:#616161; line-height:1.5; }
        .wholesale-access-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; margin-top:22px; }
        .wholesale-access-field { display:grid; gap:7px; font-weight:650; }
        .wholesale-access-field input { width:100%; min-height:44px; padding:10px 12px; border:1px solid #c9cccf; border-radius:9px; font:inherit; }
        .wholesale-access-field select, .wholesale-access-field textarea { width:100%; min-height:44px; padding:10px 12px; border:1px solid #c9cccf; border-radius:9px; background:#fff; font:inherit; }
        .wholesale-access-field textarea { min-height:88px; resize:vertical; }
        .wholesale-access-field input:focus { outline:2px solid #005bd3; outline-offset:1px; }
        .wholesale-access-field small { color:#616161; font-weight:400; }
        .wholesale-access-full { grid-column:1/-1; }
        .wholesale-access-actions { display:flex; gap:10px; flex-wrap:wrap; margin-top:20px; }
        .wholesale-access-button { min-height:40px; padding:9px 16px; border:0; border-radius:8px; background:#303030; color:#fff; font:inherit; font-weight:700; cursor:pointer; }
        .wholesale-access-button:disabled { opacity:.55; cursor:wait; }
        .wholesale-access-button--secondary { border:1px solid #c9cccf; background:#fff; color:#303030; }
        .wholesale-access-button--danger { background:#b42318; }
        .wholesale-access-alert { padding:16px; border-radius:10px; background:#eaf4ff; color:#003a6b; }
        .wholesale-access-alert--error { background:#fff0f0; color:#8e1f0b; }
        .wholesale-access-credential { margin-top:14px; padding:18px; border:2px solid #008060; border-radius:12px; background:#f1f8f5; }
        .wholesale-access-credential code { display:block; width:fit-content; margin-top:8px; padding:9px 12px; border-radius:7px; background:#fff; color:#202223; font-size:16px; user-select:all; }
        .wholesale-access-list { display:grid; gap:12px; margin-top:20px; }
        .wholesale-access-row { display:grid; grid-template-columns:minmax(220px,1.25fr) minmax(190px,1fr) auto; gap:18px; align-items:center; padding:17px; border:1px solid #e1e3e5; border-radius:11px; }
        .wholesale-access-row p { margin:3px 0 0; color:#616161; font-size:13px; }
        .wholesale-access-tags { display:flex; gap:7px; flex-wrap:wrap; margin-top:8px; }
        .wholesale-access-tag { padding:4px 8px; border-radius:999px; background:#f1f1f1; font-size:11px; font-weight:750; }
        .wholesale-access-tag--active { background:#e3f1df; color:#1b5e20; }
        .wholesale-access-tag--blocked { background:#fde8e7; color:#8e1f0b; }
        .wholesale-access-row-actions { display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
        .wholesale-access-recipients { display:grid; gap:8px; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); padding:12px; border:1px solid #dfe3e8; border-radius:9px; background:#fafafa; }
        .wholesale-access-recipient { display:flex; gap:9px; align-items:flex-start; padding:7px; font-weight:600; }
        .wholesale-access-recipient input { margin-top:3px; }
        .wholesale-access-recipient small { display:block; color:#616161; font-weight:400; }
        .wholesale-access-recipient-editor { grid-column:1/-1; padding-top:14px; border-top:1px solid #e1e3e5; }
        .wholesale-access-recipient-editor > strong { display:block; margin-bottom:4px; }
        @media(max-width:760px){ .wholesale-access-grid{grid-template-columns:1fr}.wholesale-access-full{grid-column:auto}.wholesale-access-row{grid-template-columns:1fr}.wholesale-access-row-actions{justify-content:flex-start} }
      `}</style>

      <div className="wholesale-access-layout">
        {actionData ? (
          <div className={`wholesale-access-alert ${actionData.success ? "" : "wholesale-access-alert--error"}`}>
            <strong>{actionData.message}</strong>
            {actionData.credentials ? (
              <div className="wholesale-access-credential">
                <strong>Copie agora. A senha nao sera exibida novamente.</strong>
                <p>E-mail: {actionData.credentials.email}</p>
                {actionData.credentials.company ? <p>Empresa: {actionData.credentials.company}</p> : null}
                <code>{actionData.credentials.temporaryPassword}</code>
              </div>
            ) : null}
          </div>
        ) : null}

        {pendingDocumentSubmissions.length > 0 ? (
          <div className="wholesale-access-card">
            <h2>Documentos aguardando aprovacao</h2>
            <p className="wholesale-access-muted">
              Revise o PDF gerado antes de aprovar. Ao aprovar, o documento final e liberado para download pelo revendedor.
            </p>

            <div className="wholesale-access-list">
              {pendingDocumentSubmissions.map((submission) => (
                <div className="wholesale-access-row" key={submission.id}>
                  <div>
                    <strong>{submission.resourceTitle}</strong>
                    <p>
                      {submission.customerName || submission.customerEmail}
                      {submission.customerEmail ? ` · ${submission.customerEmail}` : ""}
                    </p>
                  </div>
                  <div>
                    <strong>{submission.companyName || "Empresa nao identificada"}</strong>
                    <p>{submission.companyCnpj}</p>
                    <p>
                      Enviado em{" "}
                      {submission.submittedAt
                        ? new Date(submission.submittedAt).toLocaleString("pt-BR")
                        : "data desconhecida"}
                    </p>
                    <p>
                      {submission.hasPdf ? (
                        <a href={`/app/wholesale-document/${submission.id}/pdf`} target="_blank" rel="noreferrer">
                          Ver PDF gerado
                        </a>
                      ) : (
                        "PDF nao gerado"
                      )}
                      {submission.hasDocx ? (
                        <>
                          {" · "}
                          <a href={`/app/wholesale-document/${submission.id}/docx`} target="_blank" rel="noreferrer">
                            Baixar DOCX
                          </a>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="wholesale-access-row-actions">
                    <Form method="post">
                      <input type="hidden" name="intent" value="approve-document-submission" />
                      <input type="hidden" name="submissionId" value={submission.id} />
                      <button className="wholesale-access-button" type="submit" disabled={submitting}>
                        Aprovar
                      </button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent" value="reject-document-submission" />
                      <input type="hidden" name="submissionId" value={submission.id} />
                      <button className="wholesale-access-button wholesale-access-button--danger" type="submit" disabled={submitting}>
                        Rejeitar
                      </button>
                    </Form>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="wholesale-access-card">
          <h2>Criar acesso</h2>
          <p className="wholesale-access-muted">
            Loja: {shop}. A senha criada aqui e temporaria e devera ser trocada no primeiro login.
          </p>

          <Form method="post">
            <input type="hidden" name="intent" value="create" />
            <div className="wholesale-access-grid">
              <Field label="CNPJ" name="cnpj" required placeholder="00.000.000/0001-00" />
              <Field label="ID do cliente no Olist" name="olistCustomerId" placeholder="Opcional" />
              <Field label="Razao social" name="legalName" required placeholder="Empresa Exemplo LTDA" />
              <Field label="Nome fantasia" name="tradeName" placeholder="Opcional" />
              <Field label="Nome da pessoa" name="name" required placeholder="Nome completo" />
              <Field label="E-mail de acesso" name="email" type="email" required placeholder="compras@empresa.com" />
              <div className="wholesale-access-full">
                <Field
                  label="Senha temporaria"
                  name="temporaryPassword"
                  type="password"
                  placeholder="Deixe vazio para gerar automaticamente"
                  help="Se preenchida, use pelo menos 12 caracteres. A opcao mais segura e deixar o sistema gerar."
                />
              </div>
            </div>
            <div className="wholesale-access-actions">
              <button className="wholesale-access-button" type="submit" disabled={submitting}>
                {submitting ? "Criando..." : "Criar acesso atacadista"}
              </button>
            </div>
          </Form>
        </div>

        <div className="wholesale-access-card">
          <h2>Acessos cadastrados</h2>
          <p className="wholesale-access-muted">
            {accesses.length} acesso(s) encontrado(s). Senhas existentes nunca sao exibidas.
          </p>
          <div className="wholesale-access-list">
            {accesses.length === 0 ? <p>Nenhum acesso atacadista cadastrado.</p> : null}
            {accesses.map((access) => (
              <div className="wholesale-access-row" key={`${access.companyId}-${access.customerId}`}>
                <div>
                  <strong>{access.name}</strong>
                  <p>{access.email}</p>
                  <div className="wholesale-access-tags">
                    <span className={`wholesale-access-tag ${access.active ? "wholesale-access-tag--active" : "wholesale-access-tag--blocked"}`}>
                      {access.active ? "Ativo" : "Bloqueado"}
                    </span>
                    {access.mustChangePassword ? <span className="wholesale-access-tag">Troca de senha pendente</span> : null}
                  </div>
                </div>
                <div>
                  <strong>{access.tradeName || access.legalName}</strong>
                  <p>{access.legalName}</p>
                  <p>CNPJ: {formatCnpj(access.cnpj)}</p>
                </div>
                <div className="wholesale-access-row-actions">
                  <Form method="post">
                    <input type="hidden" name="intent" value="reset-password" />
                    <input type="hidden" name="customerId" value={access.customerId} />
                    <button className="wholesale-access-button wholesale-access-button--secondary" type="submit" disabled={submitting}>
                      Nova senha temporaria
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="set-active" />
                  +  <input type="hidden" name="customerId" value={access.customerId} />
                    <input type="hidden" name="active" value={access.active ? "false" : "true"} />
                    <button className={`wholesale-access-button ${access.active ? "wholesale-access-button--danger" : ""}`} type="submit" disabled={submitting}>
                      {access.active ? "Bloquear" : "Reativar"}
                   </button>
                  </Form>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="wholesale-access-card">
          <h2>Contratos, manuais e materiais</h2>
          <p className="wholesale-access-muted">
            Use links HTTPS. Deixe a empresa em &quot;Todos os revendedores&quot; para manuais, catalogos e politicas gerais.
          </p>

          <Form method="post" encType="multipart/form-data">
            <input type="hidden" name="intent" value="create-resource" />
            <div className="wholesale-access-grid">
              <label className="wholesale-access-field" htmlFor="resource-type">
                <span>Tipo</span>
                <select id="resource-type" name="type" defaultValue="MANUAL">
                  <option value="CONTRACT">Contrato</option>
                  <option value="MANUAL">Manual</option>
                  <option value="CATALOG">Catalogo</option>
                  <option value="POLICY">Politica comercial</option>
                  <option value="OTHER">Outro material</option>
                </select>
              </label>
              <label className="wholesale-access-field" htmlFor="resource-company">
                <span>Quem pode visualizar</span>
                <select id="resource-company" name="companyId" defaultValue="">
                  <option value="">Todos os revendedores</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>{company.name}</option>
                  ))}
                </select>
              </label>

<label
  className="wholesale-access-field wholesale-access-full"
  htmlFor="resource-delivery-type"
>
  <span>Forma do material</span>

  <select
    id="resource-delivery-type"
    name="deliveryType"
    defaultValue="LINK"
  >
    <option value="LINK">Link HTTPS</option>
    <option value="FILLABLE_DOCUMENT">
      Documento preenchivel pelo portal
    </option>
  </select>

  <small>
    Documentos preenchiveis poderao ser salvos como rascunho e finalizados pelo revendedor.
  </small>
</label>
              <Field label="Titulo" name="title" required placeholder="Contrato comercial 2026" />
              <Field label="Link HTTPS" name="url" type="url" placeholder="https://.../arquivo.pdf" />
<label
  className="wholesale-access-field wholesale-access-full"
  htmlFor="resource-template"
>
  <span>Arquivo modelo (.docx)</span>

  <input
    id="resource-template"
    name="templateFile"
    type="file"
    accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  />

  <small>
    Use este campo quando a forma do material for &quot;Documento preenchivel pelo portal&quot;.
  </small>
</label>
<div className="wholesale-access-field wholesale-access-full">
  <span>Opcoes do documento preenchivel</span>

  <label>
    <input type="checkbox" name="allowDraft" defaultChecked />{" "}
    Permitir salvar rascunho
  </label>

  <label>
    <input type="checkbox" name="allowDownload" defaultChecked />{" "}
    Permitir download apos conclusao
  </label>

<label>
  <input type="checkbox" name="generatePdf" defaultChecked />{" "}
  Gerar PDF ao finalizar
</label>

<label>
  <input type="checkbox" name="requiresApproval" defaultChecked />{" "}
  Exigir aprovacao da Mibro
</label>
</div>

<Field
  label="Ordem de exibicao"
  name="displayOrder"
  type="number"
  placeholder="0"
/>
              <label className="wholesale-access-field wholesale-access-full" htmlFor="resource-description">
                <span>Descricao</span>
                <textarea id="resource-description" name="description" placeholder="Explique brevemente o conteudo do arquivo." />
              </label>
              <div className="wholesale-access-field wholesale-access-full">
                <span>Pessoas com acesso exclusivo</span>
                <p className="wholesale-access-muted">
                  Marque uma ou mais pessoas. Sem selecao, o material sera exibido para todos dentro do escopo acima.
                </p>
                <RecipientChecklist people={people} />
              </div>
            </div>
            <div className="wholesale-access-actions">
              <button className="wholesale-access-button" type="submit" disabled={submitting}>
                {submitting ? "Salvando..." : "Adicionar material"}
              </button>
            </div>
          </Form>

          <div className="wholesale-access-list">
            {resources.length === 0 ? <p>Nenhum material cadastrado.</p> : null}
            {resources.map((resource) => (
              <div className="wholesale-access-row" key={resource.id}>
                <div>
                  <strong>{resource.title}</strong>
                  <p>{resource.description || "Sem descricao"}</p>
                  <div className="wholesale-access-tags">
                    <span className="wholesale-access-tag">{resourceTypeLabel(resource.type)}</span>
                    <span className={`wholesale-access-tag ${resource.active ? "wholesale-access-tag--active" : "wholesale-access-tag--blocked"}`}>
                      {resource.active ? "Visivel" : "Oculto"}
                    </span>
                  </div>
                </div>
                <div>
                  <strong>{resource.company?.tradeName || resource.company?.legalName || "Todos os revendedores"}</strong>
                  {resource.deliveryType === "FILLABLE_DOCUMENT" ? (
  <p>Documento preenchivel pelo portal</p>
) : resource.url ? (
  <p>
    <a href={resource.url} target="_blank" rel="noreferrer">
      Abrir arquivo
    </a>
  </p>
) : (
  <p>Sem link informado</p>
)}
                  <p>
                    {resource.recipients.length
                      ? `Exclusivo para ${resource.recipients.length} pessoa(s)`
                      : "Todos dentro deste escopo"}
                  </p>
                </div>
                <div className="wholesale-access-row-actions">
                  <Form method="post">
                    <input type="hidden" name="intent" value="set-resource-active" />
                    <input type="hidden" name="resourceId" value={resource.id} />
                    <input type="hidden" name="active" value={resource.active ? "false" : "true"} />
                    <button className="wholesale-access-button wholesale-access-button--secondary" type="submit" disabled={submitting}>
                      {resource.active ? "Ocultar" : "Exibir"}
                    </button>
                  </Form>
                </div>
                <Form method="post" className="wholesale-access-recipient-editor">
                  <input type="hidden" name="intent" value="set-resource-recipients" />
                  <input type="hidden" name="resourceId" value={resource.id} />
                  <strong>Destinatarios deste material</strong>
                  <p className="wholesale-access-muted">
                    Selecione exatamente quem pode visualizar. Deixe todos desmarcados para liberar ao escopo inteiro.
                  </p>
                  <RecipientChecklist
                    people={people}
                    selectedIds={resource.recipients.map(({ customerId }) => customerId)}
                  />
                  <div className="wholesale-access-actions">
                    <button className="wholesale-access-button wholesale-access-button--secondary" type="submit" disabled={submitting}>
                      Salvar destinatarios
                    </button>
                 </div>
                </Form>
              </div>
            ))}
          </div>
        </div>
      </div>
    </s-page>
  );
}

function RecipientChecklist({ people, selectedIds = [] }) {
  const selected = new Set(selectedIds);
  if (people.length === 0) {
    return <p className="wholesale-access-muted">Crie um acesso atacadista antes de selecionar destinatarios.</p>;
  }

  return (
    <div className="wholesale-access-recipients">
      {people.map((person) => (
        <label className="wholesale-access-recipient" key={person.id}>
          <input
            type="checkbox"
            name="customerIds"
            value={person.id}
            defaultChecked={selected.has(person.id)}
          />
          <span>
            {person.name || person.email}
            <small>{person.email} · {person.company}{person.active ? "" : " · acesso bloqueado"}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

function resourceTypeLabel(type) {
  return {
    CONTRACT: "Contrato",
    MANUAL: "Manual",
    CATALOG: "Catalogo",
    POLICY: "Politica comercial",
    OTHER: "Outro",
  }[type] || "Material";
}
