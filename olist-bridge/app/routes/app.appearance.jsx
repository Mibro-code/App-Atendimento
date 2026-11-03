import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

import {useState} from "react";

import db from "../db.server";
import {authenticate} from "../shopify.server";

const BACKGROUNDS = [
  {
    value: "transparent",
    label: "Transparente",
  },
  {
    value: "subdued",
    label: "Suave",
  },
  {
    value: "base",
    label: "Base",
  },
];

const NOTICE_TONES = [
  {
    value: "info",
    label: "Informação",
  },
  {
    value: "success",
    label: "Sucesso",
  },
  {
    value: "warning",
    label: "Aviso",
  },
  {
    value: "critical",
    label: "Crítico",
  },
];

const NUMBER_TONES = [
  {
    value: "auto",
    label: "Automático",
  },
  {
    value: "neutral",
    label: "Neutro",
  },
  {
    value: "critical",
    label: "Crítico",
  },
];

const BORDER_WIDTHS = [
  {
    value: "base",
    label: "Fina",
  },
  {
    value: "large",
    label: "Média",
  },
  {
    value: "large-100",
    label: "Forte",
  },
  {
    value: "large-200",
    label: "Muito forte",
  },
];

const BORDER_RADII = [
  {
    value: "none",
    label: "Sem arredondamento",
  },
  {
    value: "small",
    label: "Pequeno",
  },
  {
    value: "base",
    label: "Padrão",
  },
  {
    value: "large",
    label: "Grande",
  },
  {
    value: "max",
    label: "Máximo",
  },
];

const DEFAULT_VALUES = {
  accountBackground: "transparent",
  quickCardBackground: "transparent",
  orderCardBackground: "transparent",

  noticeTone: "info",
  numberTone: "auto",

  accountBorderWidth: "base",
  quickCardBorderWidth: "base",
  orderCardBorderWidth: "base",

  accountBorderRadius: "base",
  quickCardBorderRadius: "base",
  orderCardBorderRadius: "base",
};

function getOption(
  formData,
  fieldName,
  allowedValues,
  fallback,
) {
  const value = formData.get(fieldName);

  if (
    typeof value === "string" &&
    allowedValues.includes(value)
  ) {
    return value;
  }

  return fallback;
}

export async function loader({request}) {
  const {session} =
    await authenticate.admin(request);

  const settings =
    await db.appearanceSettings.findUnique({
      where: {
        shop: session.shop,
      },
    });

  return {
    shop: session.shop,
    settings: settings ?? DEFAULT_VALUES,
  };
}

export async function action({request}) {
  const {session} =
    await authenticate.admin(request);

  const formData = await request.formData();

  try {
    const data = {
      accountBackground: getOption(
        formData,
        "accountBackground",
        BACKGROUNDS.map((item) => item.value),
        DEFAULT_VALUES.accountBackground,
      ),

      quickCardBackground: getOption(
        formData,
        "quickCardBackground",
        BACKGROUNDS.map((item) => item.value),
        DEFAULT_VALUES.quickCardBackground,
      ),

      orderCardBackground: getOption(
        formData,
        "orderCardBackground",
        BACKGROUNDS.map((item) => item.value),
        DEFAULT_VALUES.orderCardBackground,
      ),

      noticeTone: getOption(
        formData,
        "noticeTone",
        NOTICE_TONES.map((item) => item.value),
        DEFAULT_VALUES.noticeTone,
      ),

      numberTone: getOption(
        formData,
        "numberTone",
        NUMBER_TONES.map((item) => item.value),
        DEFAULT_VALUES.numberTone,
      ),

      accountBorderWidth: getOption(
        formData,
        "accountBorderWidth",
        BORDER_WIDTHS.map((item) => item.value),
        DEFAULT_VALUES.accountBorderWidth,
      ),

      quickCardBorderWidth: getOption(
        formData,
        "quickCardBorderWidth",
        BORDER_WIDTHS.map((item) => item.value),
        DEFAULT_VALUES.quickCardBorderWidth,
      ),

      orderCardBorderWidth: getOption(
        formData,
        "orderCardBorderWidth",
        BORDER_WIDTHS.map((item) => item.value),
        DEFAULT_VALUES.orderCardBorderWidth,
      ),

      accountBorderRadius: getOption(
        formData,
        "accountBorderRadius",
        BORDER_RADII.map((item) => item.value),
        DEFAULT_VALUES.accountBorderRadius,
      ),

      quickCardBorderRadius: getOption(
        formData,
        "quickCardBorderRadius",
        BORDER_RADII.map((item) => item.value),
        DEFAULT_VALUES.quickCardBorderRadius,
      ),

      orderCardBorderRadius: getOption(
        formData,
        "orderCardBorderRadius",
        BORDER_RADII.map((item) => item.value),
        DEFAULT_VALUES.orderCardBorderRadius,
      ),
    };

    await db.appearanceSettings.upsert({
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
      message:
        "Aparência salva com sucesso.",
      settings: data,
    };
  } catch (error) {
    console.error(
      "Erro ao salvar aparência:",
      error,
    );

    return {
      success: false,
      message:
        "Não foi possível salvar a aparência.",
    };
  }
}

function SelectField({
  label,
  description,
  name,
  value,
  options,
  onChange,
}) {
  return (
    <label className="appearance-field">
      <span className="appearance-label">
        {label}
      </span>

      <span className="appearance-help">
        {description}
      </span>

      <select
        name={name}
        value={value}
        onChange={onChange}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
          >
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SettingsGroup({
  title,
  description,
  children,
}) {
  return (
    <section className="settings-group">
      <h3>{title}</h3>
      <p>{description}</p>

      <div className="settings-grid">
        {children}
      </div>
    </section>
  );
}

function previewBackground(value) {
  if (value === "subdued") {
    return "#f3f3f3";
  }

  if (value === "base") {
    return "#ffffff";
  }

  return "transparent";
}

function previewBorderWidth(value) {
  const widths = {
    base: "1px",
    large: "2px",
    "large-100": "3px",
    "large-200": "4px",
  };

  return widths[value] || "1px";
}

function previewBorderRadius(value) {
  const radii = {
    none: "0",
    small: "4px",
    base: "8px",
    large: "14px",
    max: "999px",
  };

  return radii[value] || "8px";
}

function previewTone(value) {
  const tones = {
    info: {
      background: "#eaf4ff",
      color: "#005bd3",
      border: "#b4d7ff",
    },

    success: {
      background: "#eaf7ef",
      color: "#174d2b",
      border: "#a7d7b5",
    },

    warning: {
      background: "#fff5d6",
      color: "#5e4200",
      border: "#ead58b",
    },

    critical: {
      background: "#fff1f0",
      color: "#8e1f0b",
      border: "#f0b4a8",
    },

    neutral: {
      background: "#eeeeee",
      color: "#303030",
      border: "#d7d7d7",
    },

    auto: {
      background: "#eeeeee",
      color: "#303030",
      border: "#d7d7d7",
    },
  };

  return tones[value] || tones.info;
}

export default function AppearancePage() {
  const {
    shop,
    settings: storedSettings,
  } = useLoaderData();

  const actionData = useActionData();
  const navigation = useNavigation();

  const [values, setValues] = useState({
    ...DEFAULT_VALUES,
    ...storedSettings,
  });

  const isSaving =
    navigation.state === "submitting";

  function update(event) {
    const {name, value} = event.target;

    setValues((current) => ({
      ...current,
      [name]: value,
    }));
  }

  const accountStyle = {
    background:
      previewBackground(
        values.accountBackground,
      ),

    border: `${previewBorderWidth(
      values.accountBorderWidth,
    )} solid #d7d7d7`,

    borderRadius:
      previewBorderRadius(
        values.accountBorderRadius,
      ),
  };

  const quickCardStyle = {
    background:
      previewBackground(
        values.quickCardBackground,
      ),

    border: `${previewBorderWidth(
      values.quickCardBorderWidth,
    )} solid #d7d7d7`,

    borderRadius:
      previewBorderRadius(
        values.quickCardBorderRadius,
      ),
  };

  const orderStyle = {
    background:
      previewBackground(
        values.orderCardBackground,
      ),

    border: `${previewBorderWidth(
      values.orderCardBorderWidth,
    )} solid #d7d7d7`,

    borderRadius:
      previewBorderRadius(
        values.orderCardBorderRadius,
      ),
  };

  const noticeStyle =
    previewTone(values.noticeTone);

  const numberStyle =
    previewTone(values.numberTone);

  return (
    <s-page heading="Aparência da Central">
      <style>{`
        .appearance-container {
          max-width: 1220px;
          margin: 0 auto;
          padding: 24px 20px 48px;
        }

        .appearance-layout {
          display: grid;
          grid-template-columns:
            minmax(340px, 470px) 1fr;
          gap: 24px;
          align-items: start;
        }

        .appearance-panel,
        .appearance-preview {
          padding: 24px;
          background: #ffffff;
          border: 1px solid #dedede;
          border-radius: 14px;
          box-shadow:
            0 2px 8px rgba(0, 0, 0, .05);
        }

        .appearance-panel h2,
        .appearance-preview h2 {
          margin: 0 0 8px;
        }

        .appearance-description {
          margin: 0 0 22px;
          color: #616161;
          line-height: 1.5;
        }

        .appearance-shop {
          padding: 12px 14px;
          margin-bottom: 20px;
          background: #f3f3f3;
          border-radius: 8px;
        }

        .settings-group {
          padding-top: 20px;
          margin-top: 20px;
          border-top: 1px solid #dedede;
        }

        .settings-group h3 {
          margin: 0 0 5px;
          font-size: 17px;
        }

        .settings-group > p {
          margin: 0 0 16px;
          color: #616161;
          font-size: 13px;
          line-height: 1.4;
        }

        .settings-grid {
          display: grid;
          grid-template-columns:
            repeat(2, minmax(0, 1fr));
          gap: 16px;
        }

        .appearance-field {
          display: grid;
          align-content: start;
          gap: 6px;
        }

        .appearance-label {
          color: #303030;
          font-weight: 650;
        }

        .appearance-help {
          min-height: 36px;
          color: #616161;
          font-size: 13px;
          line-height: 1.35;
        }

        .appearance-field select {
          box-sizing: border-box;
          width: 100%;
          min-height: 42px;
          padding: 8px 12px;
          color: #202223;
          background: #ffffff;
          border: 1px solid #8a8a8a;
          border-radius: 8px;
          font: inherit;
        }

        .appearance-actions {
          position: sticky;
          bottom: 0;
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 12px;
          margin-top: 24px;
          padding: 14px 0;
          background:
            rgba(255, 255, 255, .95);
          backdrop-filter: blur(8px);
        }

        .appearance-message {
          font-size: 13px;
          font-weight: 650;
        }

        .appearance-success {
          color: #174d2b;
        }

        .appearance-error {
          color: #8e1f0b;
        }

        .appearance-save {
          min-height: 42px;
          padding: 10px 18px;
          color: #ffffff;
          background: #303030;
          border: 0;
          border-radius: 8px;
          font-weight: 700;
          cursor: pointer;
        }

        .preview-area {
          padding: 22px;
          background: #f7f7f7;
          border-radius: 12px;
        }

        .preview-header span {
          color: #616161;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: .06em;
        }

        .preview-header h3 {
          margin: 7px 0 5px;
          font-size: 24px;
        }

        .preview-header p {
          margin: 0 0 20px;
          color: #616161;
        }

        .preview-main {
          display: grid;
          grid-template-columns:
            .8fr 1.5fr;
          gap: 14px;
        }

        .preview-card {
          padding: 16px;
        }

        .preview-card h4 {
          margin: 8px 0 4px;
        }

        .preview-card p {
          margin: 0;
          color: #616161;
          font-size: 13px;
          line-height: 1.4;
        }

        .preview-cards {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .preview-number {
          display: inline-flex;
          padding: 3px 7px;
          border-style: solid;
          border-width: 1px;
          border-radius: 99px;
          font-size: 12px;
          font-weight: 700;
        }

        .preview-link {
          display: inline-flex;
          margin-top: 10px;
          color: #005bd3;
          font-size: 13px;
          text-decoration: underline;
        }

        .preview-notice {
          margin-top: 14px;
          padding: 12px 14px;
          border-style: solid;
          border-width: 1px;
          border-radius: 8px;
          font-size: 13px;
        }

        .preview-orders {
          margin-top: 14px;
        }

        @media (max-width: 900px) {
          .appearance-layout,
          .preview-main {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 600px) {
          .settings-grid,
          .preview-cards {
            grid-template-columns: 1fr;
          }

          .appearance-help {
            min-height: auto;
          }
        }
      `}</style>

      <div className="appearance-container">
        <div className="appearance-layout">
          <Form
            method="post"
            className="appearance-panel"
          >
            <h2>Personalização compatível</h2>

            <p className="appearance-description">
              As opções abaixo são suportadas pela
              Central nativa da Shopify e serão
              aplicadas após salvar.
            </p>

            <div className="appearance-shop">
              <strong>Loja:</strong> {shop}
            </div>

            <SettingsGroup
              title="Minha conta"
              description="Aparência do card com os dados do cliente."
            >
              <SelectField
                label="Fundo"
                description="Cor de fundo compatível."
                name="accountBackground"
                value={
                  values.accountBackground
                }
                options={BACKGROUNDS}
                onChange={update}
              />

              <SelectField
                label="Borda"
                description="Espessura da borda."
                name="accountBorderWidth"
                value={
                  values.accountBorderWidth
                }
                options={BORDER_WIDTHS}
                onChange={update}
              />

              <SelectField
                label="Arredondamento"
                description="Formato dos cantos."
                name="accountBorderRadius"
                value={
                  values.accountBorderRadius
                }
                options={BORDER_RADII}
                onChange={update}
              />
            </SettingsGroup>

            <SettingsGroup
              title="Acessos rápidos"
              description="Aparência dos cards Pedidos, Garantia, Suporte e outros."
            >
              <SelectField
                label="Fundo"
                description="Cor de fundo compatível."
                name="quickCardBackground"
                value={
                  values.quickCardBackground
                }
                options={BACKGROUNDS}
                onChange={update}
              />

              <SelectField
                label="Borda"
                description="Espessura da borda."
                name="quickCardBorderWidth"
                value={
                  values.quickCardBorderWidth
                }
                options={BORDER_WIDTHS}
                onChange={update}
              />

              <SelectField
                label="Arredondamento"
                description="Formato dos cantos."
                name="quickCardBorderRadius"
                value={
                  values.quickCardBorderRadius
                }
                options={BORDER_RADII}
                onChange={update}
              />

              <SelectField
                label="Tom dos números"
                description="Cor dos marcadores 01, 02 e seguintes."
                name="numberTone"
                value={values.numberTone}
                options={NUMBER_TONES}
                onChange={update}
              />
            </SettingsGroup>

            <SettingsGroup
              title="Pedidos recentes"
              description="Aparência dos cards de pedidos."
            >
              <SelectField
                label="Fundo"
                description="Cor de fundo compatível."
                name="orderCardBackground"
                value={
                  values.orderCardBackground
                }
                options={BACKGROUNDS}
                onChange={update}
              />

              <SelectField
                label="Borda"
                description="Espessura da borda."
                name="orderCardBorderWidth"
                value={
                  values.orderCardBorderWidth
                }
                options={BORDER_WIDTHS}
                onChange={update}
              />

              <SelectField
                label="Arredondamento"
                description="Formato dos cantos."
                name="orderCardBorderRadius"
                value={
                  values.orderCardBorderRadius
                }
                options={BORDER_RADII}
                onChange={update}
              />
            </SettingsGroup>

            <SettingsGroup
              title="Aviso de segurança"
              description="Tom semântico do aviso abaixo dos acessos rápidos."
            >
              <SelectField
                label="Tom do aviso"
                description="Informação, sucesso, aviso ou crítico."
                name="noticeTone"
                value={values.noticeTone}
                options={NOTICE_TONES}
                onChange={update}
              />
            </SettingsGroup>

            <div className="appearance-actions">
              {actionData?.message && (
                <span
                  className={`appearance-message ${
                    actionData.success
                      ? "appearance-success"
                      : "appearance-error"
                  }`}
                >
                  {actionData.message}
                </span>
              )}

              <button
                className="appearance-save"
                type="submit"
                disabled={isSaving}
              >
                {isSaving
                  ? "Salvando..."
                  : "Salvar aparência"}
              </button>
            </div>
          </Form>

          <section className="appearance-preview">
            <h2>Prévia aproximada</h2>

            <p className="appearance-description">
              A prévia utiliza apenas opções
              compatíveis com a Central real.
            </p>

            <div className="preview-area">
              <header className="preview-header">
                <span>● ÁREA DO CLIENTE</span>

                <h3>Central do Cliente</h3>

                <p>
                  Pedidos, suporte e informações da
                  conta em um só lugar.
                </p>
              </header>

              <div className="preview-main">
                <article
                  className="preview-card"
                  style={accountStyle}
                >
                  <strong>M</strong>
                  <h4>Minha conta</h4>

                  <p>
                    Gerencie seus dados e endereços.
                  </p>

                  <span className="preview-link">
                    Editar dados
                  </span>
                </article>

                <div>
                  <div className="preview-cards">
                    {[
                      "Meus pedidos",
                      "Garantia",
                      "Suporte",
                      "Aplicativo Fit",
                    ].map((title, index) => (
                      <article
                        className="preview-card"
                        style={quickCardStyle}
                        key={title}
                      >
                        <span
                          className="preview-number"
                          style={{
                            background:
                              numberStyle.background,
                            color:
                              numberStyle.color,
                            borderColor:
                              numberStyle.border,
                          }}
                        >
                          0{index + 1}
                        </span>

                        <h4>{title}</h4>

                        <p>
                          Acesse informações e
                          serviços.
                        </p>

                        <span className="preview-link">
                          Acessar
                        </span>
                      </article>
                    ))}
                  </div>

                  <div
                    className="preview-notice"
                    style={{
                      background:
                        noticeStyle.background,
                      color:
                        noticeStyle.color,
                      borderColor:
                        noticeStyle.border,
                    }}
                  >
                    Dados sensíveis são gerenciados
                    pela área oficial da Shopify.
                  </div>
                </div>
              </div>

              <article
                className="preview-card preview-orders"
                style={orderStyle}
              >
                <h4>Pedidos recentes</h4>

                <p>
                  Seus últimos pedidos aparecerão
                  aqui.
                </p>
              </article>
            </div>
          </section>
        </div>
      </div>
    </s-page>
  );
}