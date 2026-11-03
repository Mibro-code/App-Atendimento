import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

import db from "../db.server";
import { authenticate } from "../shopify.server";

const DEFAULT_LINKS = {
  warrantyLabel: "Garantia",
  warrantyUrl: "/pages/garantia",

  appLabel: "Aplicativo Fit",
  appUrl: "/pages/aplicativo-fit",

  supportLabel: "Suporte",
  supportUrl: "/pages/contato",

  installationGuideLabel: "Guia de instalação",
  installationGuideUrl: "/pages/guias-de-instalacao",

  warrantyRequestLabel: "Acionar garantia",
  warrantyRequestUrl: "/pages/garantia",

  contactSupportLabel: "Falar com suporte",
  contactSupportUrl: "/pages/contato",

  policiesLabel: "Ver políticas da loja",
  policiesUrl: "/pages/politicas",
};

function getText(formData, fieldName, fallback) {
  const value = formData.get(fieldName);

  if (typeof value !== "string") {
    return fallback;
  }

  const trimmedValue = value.trim();

  return trimmedValue || fallback;
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

  const settings = await db.centralLinkSettings.findUnique({
    where: {
      shop: session.shop,
    },
  });

  return {
    shop: session.shop,
    settings: settings ?? DEFAULT_LINKS,
  };
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  try {
    const data = {
      warrantyLabel: getText(
        formData,
        "warrantyLabel",
        DEFAULT_LINKS.warrantyLabel,
      ),
warrantyUrl: getText(
  formData,
  "warrantyUrl",
  DEFAULT_LINKS.warrantyUrl,
),

appLabel: getText(
  formData,
  "appLabel",
  DEFAULT_LINKS.appLabel,
),
appUrl: getText(
  formData,
  "appUrl",
  DEFAULT_LINKS.appUrl,
),

supportLabel: getText(
  formData,
  "supportLabel",
  DEFAULT_LINKS.supportLabel,
),
supportUrl: getText(
  formData,
  "supportUrl",
  DEFAULT_LINKS.supportUrl,
),

installationGuideLabel: getText(
  formData,
  "installationGuideLabel",
  DEFAULT_LINKS.installationGuideLabel,
),
installationGuideUrl: getText(
  formData,
  "installationGuideUrl",
  DEFAULT_LINKS.installationGuideUrl,
),

warrantyRequestLabel: getText(
  formData,
  "warrantyRequestLabel",
  DEFAULT_LINKS.warrantyRequestLabel,
),
warrantyRequestUrl: getText(
  formData,
  "warrantyRequestUrl",
  DEFAULT_LINKS.warrantyRequestUrl,
),

contactSupportLabel: getText(
  formData,
  "contactSupportLabel",
  DEFAULT_LINKS.contactSupportLabel,
),
contactSupportUrl: getText(
  formData,
  "contactSupportUrl",
  DEFAULT_LINKS.contactSupportUrl,
),

policiesLabel: getText(
  formData,
  "policiesLabel",
  DEFAULT_LINKS.policiesLabel,
),
policiesUrl: getText(
  formData,
  "policiesUrl",
  DEFAULT_LINKS.policiesUrl,
),
    };

    await db.centralLinkSettings.upsert({
      where: {
        shop: session.shop,
      },

      create: {
        shop: session.shop,
        ...data,
      },

      update: data,
    });

    return {
      success: true,
      message: "Links e nomes da Central salvos com sucesso.",
    };
  } catch (error) {
    console.error(
      "Erro ao salvar links da Central:",
      error,
    );

    return {
      success: false,
      message:
        "Não foi possível salvar os links e nomes.",
    };
  }
}

function TextField({
  name,
  label,
  description,
  defaultValue,
  placeholder,
}) {
  return (
    <div className="central-link-field">
      <label htmlFor={name}>{label}</label>

      <p>{description}</p>

      <input
        id={name}
        name={name}
        type="text"
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="central-link-input"
        required
      />
    </div>
  );
}

function ConfigGroup({
  title,
  description,
  labelField,
  urlField,
}) {
  return (
    <div className="central-config-group">
      <div className="central-config-group-header">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>

      <div className="central-links-grid">
        {labelField}

        {urlField}
      </div>
    </div>
  );
}

export default function CentralLinksPage() {
  const { shop, settings } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();

  const isSaving =
    navigation.state === "submitting";

  return (
    <s-page heading="Links da Central">
      <style>{`
        .central-links-container {
          display: flex;
          flex-direction: column;
          gap: 20px;
          padding-bottom: 40px;
        }

        .central-links-card {
          padding: 22px;
          background: #ffffff;
          border: 1px solid #e1e3e5;
          border-radius: 12px;
        }

        .central-links-card h2 {
          margin: 0 0 6px;
          font-size: 20px;
        }

        .central-links-description {
          margin: 0 0 22px;
          color: #616161;
          line-height: 1.5;
        }

        .central-links-shop {
          margin-bottom: 20px;
          padding: 12px 14px;
          background: #f6f6f7;
          border-radius: 8px;
        }

        .central-links-grid {
          display: grid;
          grid-template-columns: repeat(
            2,
            minmax(0, 1fr)
          );
          gap: 20px;
        }

        .central-link-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .central-link-field label {
          font-weight: 650;
          color: #303030;
        }

        .central-link-field p {
          min-height: 36px;
          margin: 0;
          color: #616161;
          font-size: 13px;
          line-height: 1.4;
        }

        .central-link-input {
          box-sizing: border-box;
          width: 100%;
          min-height: 42px;
          padding: 9px 11px;
          color: #303030;
          background: #ffffff;
          border: 1px solid #8a8a8a;
          border-radius: 8px;
          font: inherit;
        }

        .central-link-input:focus {
          border-color: #005bd3;
          outline: 2px solid
            rgba(0, 91, 211, 0.18);
        }

        .central-config-group {
          padding: 18px;
          border: 1px solid #e1e3e5;
          border-radius: 10px;
          background: #fafafa;
        }

        .central-config-group + .central-config-group {
          margin-top: 18px;
        }

        .central-config-group-header {
          margin-bottom: 16px;
        }

        .central-config-group-header h3 {
          margin: 0 0 5px;
          font-size: 16px;
        }

        .central-config-group-header p {
          margin: 0;
          color: #616161;
          font-size: 13px;
          line-height: 1.4;
        }

        .central-links-message {
          padding: 12px 14px;
          border-radius: 8px;
          font-weight: 650;
        }

        .central-links-success {
          color: #174d2b;
          background: #e8f5ec;
          border: 1px solid #a7d7b5;
        }

        .central-links-error {
          color: #8e1f0b;
          background: #fff0ed;
          border: 1px solid #f0b4a8;
        }

        .central-links-actions {
          position: sticky;
          bottom: 0;
          display: flex;
          justify-content: flex-end;
          padding: 14px 0;
          background: rgba(
            246,
            246,
            247,
            0.95
          );
          backdrop-filter: blur(8px);
        }

        .central-links-button {
          min-height: 42px;
          padding: 10px 20px;
          color: #ffffff;
          background: #303030;
          border: 0;
          border-radius: 8px;
          font-weight: 700;
          cursor: pointer;
        }

        .central-links-button:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }

        @media (max-width: 760px) {
          .central-links-grid {
            grid-template-columns: 1fr;
          }

          .central-link-field p {
            min-height: auto;
          }
        }
      `}</style>

      <Form
        method="post"
        className="central-links-container"
      >
        {actionData?.message && (
          <div
            className={`central-links-message ${
              actionData.success
                ? "central-links-success"
                : "central-links-error"
            }`}
          >
            {actionData.message}
          </div>
        )}

        <section className="central-links-card">
          <h2>Configuração da loja</h2>

          <p className="central-links-description">
            Estes nomes e endereços serão usados
            apenas pela loja identificada abaixo.
          </p>

          <div className="central-links-shop">
            <strong>Loja:</strong> {shop}
          </div>

          <p className="central-links-description">
            Você pode usar caminhos internos, como{" "}
            <code>/pages/garantia</code>, ou URLs
            completas, como{" "}
            <code>
              https://exemplo.com/garantia
            </code>
            .
          </p>
        </section>

        <section className="central-links-card">
          <h2>Cards de acesso rápido</h2>

          <p className="central-links-description">
            Altere o nome exibido e o link de cada
            card da área principal da Central do
            Cliente.
          </p>

          <ConfigGroup
  title="Card de garantia"
  description="Configura o texto e o destino do card relacionado à garantia."
  labelField={
    <TextField
      name="warrantyLabel"
      label="Nome do card"
      description="Texto exibido como título do card."
      defaultValue={settings.warrantyLabel}
      placeholder="Garantia"
    />
  }
  urlField={
    <TextField
      name="warrantyUrl"
      label="Link do card"
      description="Página aberta quando o cliente clicar."
      defaultValue={settings.warrantyUrl}
      placeholder="/pages/garantia"
    />
  }
/>

          <ConfigGroup
            title="Card do aplicativo"
            description="Configura o texto e o destino do card relacionado ao aplicativo."
            labelField={
              <TextField
                name="appLabel"
                label="Nome do card"
                description="Texto exibido como título do card."
                defaultValue={settings.appLabel}
                placeholder="Aplicativo Fit"
              />
            }
            urlField={
              <TextField
                name="appUrl"
                label="Link do card"
                description="Página aberta quando o cliente clicar."
                defaultValue={settings.appUrl}
                placeholder="/pages/aplicativo-fit"
              />
            }
          />

          <ConfigGroup
            title="Card de suporte"
            description="Configura o texto e o destino do card relacionado ao atendimento."
            labelField={
              <TextField
                name="supportLabel"
                label="Nome do card"
                description="Texto exibido como título do card."
                defaultValue={
                  settings.supportLabel
                }
                placeholder="Suporte"
              />
            }
            urlField={
              <TextField
                name="supportUrl"
                label="Link do card"
                description="Página, WhatsApp ou canal de atendimento."
                defaultValue={settings.supportUrl}
                placeholder="/pages/contato"
              />
            }
          />
        </section>

        <section className="central-links-card">
          <h2>Após a compra</h2>

          <p className="central-links-description">
            Altere o texto e o destino dos botões
            exibidos na seção “Após a compra”.
          </p>

          <ConfigGroup
            title="Primeiro botão"
            description="Pode ser usado para guias, lançamentos, downloads ou qualquer outra página."
            labelField={
              <TextField
                name="installationGuideLabel"
                label="Nome do botão"
                description="Texto exibido no botão."
                defaultValue={
                  settings.installationGuideLabel
                }
                placeholder="Guia de instalação"
              />
            }
            urlField={
              <TextField
                name="installationGuideUrl"
                label="Link do botão"
                description="Página aberta quando o cliente clicar."
                defaultValue={
                  settings.installationGuideUrl
                }
                placeholder="/pages/guias-de-instalacao"
              />
            }
          />

          <ConfigGroup
            title="Segundo botão"
            description="Pode ser usado para garantia, assistência ou qualquer outra finalidade."
            labelField={
              <TextField
                name="warrantyRequestLabel"
                label="Nome do botão"
                description="Texto exibido no botão."
                defaultValue={
                  settings.warrantyRequestLabel
                }
                placeholder="Acionar garantia"
              />
            }
            urlField={
              <TextField
                name="warrantyRequestUrl"
                label="Link do botão"
                description="Página aberta quando o cliente clicar."
                defaultValue={
                  settings.warrantyRequestUrl
                }
                placeholder="/pages/garantia"
              />
            }
          />

          <ConfigGroup
            title="Terceiro botão"
            description="Pode ser usado para suporte, contato, WhatsApp ou outro canal."
            labelField={
              <TextField
                name="contactSupportLabel"
                label="Nome do botão"
                description="Texto exibido no botão."
                defaultValue={
                  settings.contactSupportLabel
                }
                placeholder="Falar com suporte"
              />
            }
            urlField={
              <TextField
                name="contactSupportUrl"
                label="Link do botão"
                description="Página ou endereço externo aberto ao clicar."
                defaultValue={
                  settings.contactSupportUrl
                }
                placeholder="/pages/contato"
              />
            }
          />

          <ConfigGroup
            title="Quarto botão"
            description="Pode ser usado para políticas, termos, FAQ ou outra página."
            labelField={
              <TextField
                name="policiesLabel"
                label="Nome do botão"
                description="Texto exibido no botão."
                defaultValue={
                  settings.policiesLabel
                }
                placeholder="Ver políticas da loja"
              />
            }
            urlField={
              <TextField
                name="policiesUrl"
                label="Link do botão"
                description="Página aberta quando o cliente clicar."
                defaultValue={settings.policiesUrl}
                placeholder="/pages/politicas"
              />
            }
          />
        </section>

        <div className="central-links-actions">
          <button
            type="submit"
            className="central-links-button"
            disabled={isSaving}
          >
            {isSaving
              ? "Salvando..."
              : "Salvar configurações"}
          </button>
        </div>
      </Form>
    </s-page>
  );
}