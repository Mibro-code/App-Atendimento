import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

import { authenticate } from "../shopify.server";
import {
  findOlistContactByTaxId,
  findOlistProductBySku,
  getOlistAccountInfo,
  OlistApiError,
} from "../services/olist-api.server";
import {
  createOlistAuthorizationUrl,
  createOlistOAuthState,
  disconnectOlistConnection,
  getOlistConnectionStatus,
  isOlistConfigured,
} from "../services/olist-auth.server";
import {
  getWholesaleMode,
  setWholesaleCnpjDataLevel,
  setWholesaleTestMode,
} from "../services/wholesale-mode.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const configured = isOlistConfigured();
  const connection = await getOlistConnectionStatus(session.shop);
  const wholesaleMode = await getWholesaleMode(session.shop);
  const connectionExpired = Boolean(
    connection && connection.refreshExpiresAt <= new Date(),
  );
  let authorizationUrl = null;

  if (configured && !connection) {
    try {
      const state = await createOlistOAuthState(session.shop);
      authorizationUrl = createOlistAuthorizationUrl(state);
    } catch (error) {
      console.error("Falha ao preparar OAuth da Olist", {
        name: error?.name,
        message: error?.message,
      });
    }
  }

  return {
    configured,
    connection,
    connectionExpired,
    authorizationUrl,
    wholesaleMode,
  };
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "set-test-mode") {
      const testModeEnabled = formData.get("enabled") === "true";
      const wholesaleMode = await setWholesaleTestMode(
        session.shop,
        testModeEnabled,
      );

      return {
        success: true,
        intent,
        message: testModeEnabled
          ? "Modo teste ativado. A criação de pedidos está bloqueada."
          : "Modo teste desativado. A criação de pedidos está liberada.",
        wholesaleMode,
      };
    }

    if (intent === "set-cnpj-data-level") {
      const cnpjDataLevel = formData.get("cnpjDataLevel");
      const wholesaleMode = await setWholesaleCnpjDataLevel(
        session.shop,
        cnpjDataLevel,
      );

      return {
        success: true,
        intent,
        message: "Nível global da consulta CNPJ atualizado.",
        wholesaleMode,
      };
    }

    if (intent === "test-connection") {
      const account = await getOlistAccountInfo(session.shop);

      return {
        success: true,
        intent,
        message: "A API da Olist respondeu corretamente.",
        account: {
          businessName: account?.razaoSocial || null,
          tradeName: account?.fantasia || null,
          taxId: account?.cpfCnpj || null,
          taxRegime: account?.regimeTributario || null,
        },
      };
    }

    if (intent === "reconnect-olist") {
      if (!isOlistConfigured()) {
        return {
          success: false,
          intent,
          message:
            "A configuração OAuth da Olist está incompleta no servidor.",
        };
      }

      const state = await createOlistOAuthState(session.shop);
      const authorizationUrl = createOlistAuthorizationUrl(state);

      await disconnectOlistConnection(session.shop);

      return redirect(authorizationUrl);
    }

    if (intent === "lookup-product") {
      const sku = formData.get("sku");
      const product = await findOlistProductBySku(session.shop, sku);

      return {
        success: true,
        intent,
        message: "Produto localizado na Olist.",
        product,
      };
    }

    if (intent === "lookup-contact") {
      const taxId = formData.get("taxId");
      const contact = await findOlistContactByTaxId(session.shop, taxId);

      return {
        success: true,
        intent,
        message: "Contato localizado na Olist.",
        contact,
      };
    }

    return {
      success: false,
      intent: "unknown",
      message: "Ação inválida.",
    };
  } catch (error) {
    console.error("Falha na validação da integração Olist", {
      name: error?.name,
      message: error?.message,
      status: error?.status,
    });

    return {
      success: false,
      intent: typeof intent === "string" ? intent : "unknown",
      message:
        error instanceof OlistApiError
          ? error.message
          : "Não foi possível validar a integração com a Olist.",
    };
  }
}

function ResultMessage({ actionData, intent, children }) {
  if (!actionData || actionData.intent !== intent) {
    return null;
  }

  return (
    <div
      className={`olist-result ${
        actionData.success ? "olist-result--ok" : "olist-result--error"
      }`}
      role="status"
    >
      <strong>{actionData.message}</strong>
      {actionData.success ? children : null}
    </div>
  );
}

export default function OlistIntegrationPage() {
  const {
    configured,
    connection,
    connectionExpired,
    authorizationUrl,
    wholesaleMode,
  } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submittingIntent = navigation.formData?.get("intent");
  const currentWholesaleMode = actionData?.wholesaleMode || wholesaleMode;
  const testModeEnabled = currentWholesaleMode.testModeEnabled;
  const cnpjDataLevel = currentWholesaleMode.cnpjDataLevel || "complete";

  return (
    <s-page heading="Integração Olist ERP">
      <style>{`
        .olist-container {
          display: grid;
          gap: 18px;
          max-width: 760px;
          padding-bottom: 40px;
        }

        .olist-card {
          padding: 22px;
          background: #ffffff;
          border: 1px solid #e1e3e5;
          border-radius: 12px;
        }

        .olist-card h2 {
          margin: 0 0 10px;
          font-size: 20px;
        }

        .olist-card p {
          margin: 8px 0;
          color: #4a4a4a;
          line-height: 1.5;
        }

        .olist-status {
          display: inline-block;
          margin-bottom: 10px;
          padding: 5px 10px;
          border-radius: 999px;
          font-weight: 600;
        }

        .olist-status--ok {
          color: #0a6b2b;
          background: #e5f5e9;
        }

        .olist-status--pending {
          color: #7a4d00;
          background: #fff1d6;
        }

        .olist-status--expired {
          color: #8e1f0b;
          background: #fff0ed;
        }

        .olist-reconnect-warning {
          padding: 12px 14px;
          color: #8e1f0b;
          background: #fff0ed;
          border-radius: 8px;
        }

        .olist-mode {
          border-width: 2px;
        }

        .olist-mode--test {
          border-color: #f0b95a;
          background: #fffaf0;
        }

        .olist-mode--live {
          border-color: #74b78b;
          background: #f2fbf5;
        }

        .olist-mode-badge {
          display: inline-block;
          margin-bottom: 10px;
          padding: 5px 10px;
          border-radius: 999px;
          font-weight: 700;
        }

        .olist-mode--test .olist-mode-badge {
          color: #7a4d00;
          background: #ffe8bd;
        }

        .olist-mode--live .olist-mode-badge {
          color: #0a6b2b;
          background: #dcefe2;
        }

        .olist-button,
        .olist-connect {
          display: inline-block;
          margin-top: 14px;
          padding: 10px 16px;
          color: #ffffff;
          background: #303030;
          border: 0;
          border-radius: 8px;
          text-decoration: none;
          font: inherit;
          font-weight: 600;
          cursor: pointer;
        }

        .olist-button:disabled {
          cursor: wait;
          opacity: 0.6;
        }

        .olist-field {
          display: grid;
          gap: 6px;
          margin-top: 14px;
        }

        .olist-field label {
          font-weight: 600;
        }

        .olist-field input,
        .olist-field select {
          width: 100%;
          box-sizing: border-box;
          padding: 10px 12px;
          border: 1px solid #8c9196;
          border-radius: 8px;
          font: inherit;
        }

        .olist-result {
          margin-top: 16px;
          padding: 12px 14px;
          border-radius: 8px;
          line-height: 1.5;
        }

        .olist-result--ok {
          color: #0a6b2b;
          background: #e5f5e9;
        }

        .olist-result--error {
          color: #8e1f0b;
          background: #fff0ed;
        }

        .olist-details {
          margin-top: 8px;
        }
      `}</style>

      <div className="olist-container">
        <section
          className={`olist-card olist-mode ${
            testModeEnabled ? "olist-mode--test" : "olist-mode--live"
          }`}
        >
          <span className="olist-mode-badge">
            {testModeEnabled ? "MODO TESTE ATIVO" : "MODO REAL ATIVO"}
          </span>
          <h2>Página de atacado</h2>

          {testModeEnabled ? (
            <p>
              A página pode ser aberta e validada, e as propostas podem ser
              enviadas pelo webhook configurado. A criação e a confirmação de
              pedidos permanecem bloqueadas.
            </p>
          ) : (
            <p>
              A criação de pedidos está liberada para as rotas de produção.
              Ative novamente o modo teste para bloquear novos pedidos.
            </p>
          )}

          <Form method="post">
            <input type="hidden" name="intent" value="set-test-mode" />
            <input
              type="hidden"
              name="enabled"
              value={testModeEnabled ? "false" : "true"}
            />
            <button
              className="olist-button"
              type="submit"
              disabled={submittingIntent === "set-test-mode"}
            >
              {submittingIntent === "set-test-mode"
                ? "Atualizando..."
                : testModeEnabled
                  ? "Desativar modo teste e liberar pedidos"
                  : "Ativar modo teste e bloquear pedidos"}
            </button>
          </Form>

          <ResultMessage actionData={actionData} intent="set-test-mode" />
        </section>

        <section className="olist-card">
          <h2>Padrão da consulta de CNPJ</h2>
          <p>Usado somente em páginas sem uma configuração própria no tema.</p>

          <Form method="post">
            <input type="hidden" name="intent" value="set-cnpj-data-level" />
            <div className="olist-field">
              <label htmlFor="cnpjDataLevel">
                Padrão para páginas sem configuração
              </label>
              <select
                id="cnpjDataLevel"
                name="cnpjDataLevel"
                defaultValue={cnpjDataLevel}
              >
                <option value="verify">Só verificar o CNPJ</option>
                <option value="essential">Preencher dados essenciais</option>
                <option value="complete">Preencher todos os dados</option>
              </select>
            </div>
            <button
              className="olist-button"
              type="submit"
              disabled={submittingIntent === "set-cnpj-data-level"}
            >
              {submittingIntent === "set-cnpj-data-level"
                ? "Salvando..."
                : "Salvar configuração do CNPJ"}
            </button>
          </Form>

          <ResultMessage actionData={actionData} intent="set-cnpj-data-level" />
        </section>

        <section className="olist-card">
          <span
            className={`olist-status ${
              connectionExpired
                ? "olist-status--expired"
                : connection
                  ? "olist-status--ok"
                  : "olist-status--pending"
            }`}
          >
            {connectionExpired
              ? "Autorização expirada"
              : connection
                ? "Conectado"
                : "Aguardando conexão"}
          </span>

          <h2>ERP Olist v3</h2>

          {!configured ? (
            <p>
              Configure as variáveis OLIST_CLIENT_ID, OLIST_CLIENT_SECRET,
              OLIST_REDIRECT_URI e OLIST_TOKEN_ENCRYPTION_KEY no servidor antes
              de iniciar a autorização.
            </p>
          ) : connection ? (
            <>
              {connectionExpired ? (
                <p className="olist-reconnect-warning">
                  A autorização da Olist expirou. Reconecte a conta para gerar
                  novos tokens de acesso.
                </p>
              ) : (
                <p>A conta Olist está autorizada para esta loja.</p>
              )}
              <p>
                Última atualização:{" "}
                {new Date(connection.updatedAt).toLocaleString("pt-BR")}
              </p>
              <Form method="post" target="_top">
                <input type="hidden" name="intent" value="reconnect-olist" />
                <button
                  className="olist-button"
                  type="submit"
                  disabled={submittingIntent === "reconnect-olist"}
                  onClick={(event) => {
                    const confirmed = window.confirm(
                      "Reconectar a conta Olist? A autorização atual será removida e você será encaminhado para autorizar novamente.",
                    );

                    if (!confirmed) {
                      event.preventDefault();
                    }
                  }}
                >
                  {submittingIntent === "reconnect-olist"
                    ? "Preparando reconexão..."
                    : "Reconectar conta Olist"}
                </button>
              </Form>
              <ResultMessage
                actionData={actionData}
                intent="reconnect-olist"
              />
            </>
          ) : authorizationUrl ? (
            <>
              <p>
                As credenciais do aplicativo estão configuradas. Inicie a
                autorização em uma janela de nível superior.
              </p>
              <a
                className="olist-connect"
                href={authorizationUrl}
                target="_top"
              >
                Conectar à Olist ERP
              </a>
            </>
          ) : (
            <p>
              Não foi possível preparar a autorização agora. Recarregue a
              página; se o problema continuar, verifique os logs do app.
            </p>
          )}
        </section>

        {connection ? (
          <>
            <section className="olist-card">
              <h2>Validar conta</h2>
              <p>
                Faz uma consulta somente leitura para confirmar o acesso à API e
                a renovação automática do token.
              </p>

              <Form method="post">
                <input type="hidden" name="intent" value="test-connection" />
                <button
                  className="olist-button"
                  type="submit"
                  disabled={submittingIntent === "test-connection"}
                >
                  {submittingIntent === "test-connection"
                    ? "Testando..."
                    : "Testar conexão"}
                </button>
              </Form>

              <ResultMessage actionData={actionData} intent="test-connection">
                {actionData?.account ? (
                  <div className="olist-details">
                    <div>
                      Empresa:{" "}
                      {actionData.account.tradeName ||
                        actionData.account.businessName ||
                        "não informada"}
                    </div>
                    {actionData.account.taxId ? (
                      <div>CNPJ/CPF: {actionData.account.taxId}</div>
                    ) : null}
                  </div>
                ) : null}
              </ResultMessage>
            </section>

            <section className="olist-card">
              <h2>Validar SKU</h2>
              <p>
                Localiza o ID interno que será usado para vincular o cadastro
                fiscal do produto nos pedidos.
              </p>

              <Form method="post">
                <input type="hidden" name="intent" value="lookup-product" />
                <div className="olist-field">
                  <label htmlFor="olist-sku">SKU do produto</label>
                  <input
                    id="olist-sku"
                    name="sku"
                    type="text"
                    maxLength={120}
                    autoComplete="off"
                    required
                  />
                </div>
                <button
                  className="olist-button"
                  type="submit"
                  disabled={submittingIntent === "lookup-product"}
                >
                  {submittingIntent === "lookup-product"
                    ? "Consultando..."
                    : "Buscar SKU"}
                </button>
              </Form>

              <ResultMessage actionData={actionData} intent="lookup-product">
                {actionData?.product ? (
                  <div className="olist-details">
                    <div>ID Olist: {actionData.product.id}</div>
                    <div>SKU: {actionData.product.sku}</div>
                    <div>
                      Produto: {actionData.product.description || "sem nome"}
                    </div>
                    <div>
                      Situação: {actionData.product.status || "não informada"}
                    </div>
                  </div>
                ) : null}
              </ResultMessage>
            </section>

            <section className="olist-card">
              <h2>Validar contato</h2>
              <p>
                Localiza o ID interno do comprador pelo CPF ou CNPJ, sem criar
                nem alterar cadastros.
              </p>

              <Form method="post">
                <input type="hidden" name="intent" value="lookup-contact" />
                <div className="olist-field">
                  <label htmlFor="olist-tax-id">CPF ou CNPJ</label>
                  <input
                    id="olist-tax-id"
                    name="taxId"
                    type="text"
                    inputMode="numeric"
                    maxLength={18}
                    autoComplete="off"
                    placeholder="00.000.000/0000-00"
                    required
                  />
                </div>
                <button
                  className="olist-button"
                  type="submit"
                  disabled={submittingIntent === "lookup-contact"}
                >
                  {submittingIntent === "lookup-contact"
                    ? "Consultando..."
                    : "Buscar contato"}
                </button>
              </Form>

              <ResultMessage actionData={actionData} intent="lookup-contact">
                {actionData?.contact ? (
                  <div className="olist-details">
                    <div>ID Olist: {actionData.contact.id}</div>
                    <div>
                      Nome:{" "}
                      {actionData.contact.tradeName ||
                        actionData.contact.name ||
                        "não informado"}
                    </div>
                    <div>CPF/CNPJ: {actionData.contact.taxId}</div>
                    <div>
                      Situação: {actionData.contact.status || "não informada"}
                    </div>
                    <div>
                      Status CRM:{" "}
                      {actionData.contact.crmStatus || "não informado"}
                    </div>
                  </div>
                ) : null}
              </ResultMessage>
            </section>
          </>
        ) : null}

        <section className="olist-card">
          <h2>Segurança</h2>
          <p>
            Os tokens de acesso e renovação são criptografados antes de serem
            gravados no PostgreSQL. Nenhum token é enviado para o navegador.
          </p>
        </section>
      </div>
    </s-page>
  );
}
