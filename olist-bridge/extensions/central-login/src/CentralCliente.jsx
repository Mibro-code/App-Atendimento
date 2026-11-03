import "@shopify/ui-extensions/preact";
import {useSettings} from "@shopify/ui-extensions/customer-account/preact";
import {render} from "preact";
import {useEffect, useState} from "preact/hooks";
import {APP_URL} from "./app-url";

const API_URL =
  "shopify://customer-account/api/2026-04/graphql.json";

const CONFIG = {
  fallbackShopName: "Loja",

  labels: {
    areaLabel: "● ÁREA DO CLIENTE",
    pageTitlePrefix: "Central do Cliente",
    subtitle:
      "Acesse seus pedidos, suporte, garantia e informações da sua conta em um só lugar.",
    accountTitle: "Minha conta",
    accountDescriptionPrefix:
      "Gerencie sua experiência com",
    securityNotice:
      "Por segurança, dados sensíveis como senha, pagamento e informações completas da conta são gerenciados diretamente pela área oficial da Shopify.",
  },
};

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const settings = useSettings();

  const [shopName, setShopName] = useState(
    CONFIG.fallbackShopName,
  );

  const [customer, setCustomer] = useState(null);
  const [customerLoading, setCustomerLoading] =
    useState(true);
  const [customerError, setCustomerError] =
    useState("");

  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] =
    useState(true);
  const [ordersError, setOrdersError] =
    useState("");

  const [centralLinks, setCentralLinks] =
    useState(null);

  const [appearance, setAppearance] =
    useState(null);

  useEffect(() => {
    loadShopName();
    loadCustomerData();
    loadOrders();
    loadCentralLinks();
    loadAppearance();
  // Os loaders usam apenas globals da extens?o e setters est?veis.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function graphqlRequest(
    query,
    variables = {},
  ) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    });

    return response.json();
  }

  async function loadShopName() {
    try {
      const result = await graphqlRequest(`
        query ShopName {
          shop {
            name
          }
        }
      `);

      if (result?.errors?.length) {
        console.log(
          "Erro ao carregar nome da loja:",
          result.errors,
        );
        return;
      }

      if (result?.data?.shop?.name) {
        setShopName(result.data.shop.name);
      }
    } catch (error) {
      console.log(
        "Não foi possível carregar o nome da loja.",
        error,
      );
    }
  }

  async function loadCustomerData() {
    try {
      setCustomerLoading(true);
      setCustomerError("");

      const result = await graphqlRequest(`
        query CustomerData {
          customer {
            firstName
            lastName

            emailAddress {
              emailAddress
            }

            phoneNumber {
              phoneNumber
            }

            defaultAddress {
              id
              formatted
            }
          }
        }
      `);

      if (result?.errors?.length) {
        console.log(
          "Erros ao carregar cliente:",
          result.errors,
        );

        setCustomerError(
          result.errors[0]?.message ||
            "Os dados da conta estão temporariamente indisponíveis.",
        );

        return;
      }

      if (result?.data?.customer) {
        setCustomer(result.data.customer);
      } else {
        setCustomerError(
          "Nenhum cliente logado encontrado.",
        );
      }
    } catch (error) {
      console.log(
        "Erro ao carregar cliente:",
        error,
      );

      setCustomerError(
        "Erro ao consultar os dados da conta.",
      );
    } finally {
      setCustomerLoading(false);
    }
  }

  async function loadOrders() {
    try {
      setOrdersLoading(true);
      setOrdersError("");

      const result = await graphqlRequest(`
        query CustomerOrders {
          customer {
            orders(first: 5) {
              nodes {
                id
                name
                processedAt
              }
            }
          }
        }
      `);

      if (result?.errors?.length) {
        console.log(
          "Erros ao carregar pedidos:",
          result.errors,
        );

        setOrdersError(
          result.errors[0]?.message ||
            "Não foi possível carregar os pedidos recentes.",
        );

        return;
      }

      const orderNodes =
        result?.data?.customer?.orders?.nodes ||
        [];

      setOrders(orderNodes);
    } catch (error) {
      console.log(
        "Erro ao carregar pedidos:",
        error,
      );

      setOrdersError(
        "Não foi possível carregar os pedidos recentes.",
      );
    } finally {
      setOrdersLoading(false);
    }
  }

  async function loadCentralLinks() {
    try {
      const token =
        await shopify.sessionToken.get();

      const response = await fetch(
        `${APP_URL}/api/central-links?t=${Date.now()}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        },
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
            "Não foi possível carregar as configurações da Central.",
        );
      }

      setCentralLinks(result.settings);
    } catch (error) {
      console.error(
        "Erro ao carregar links configuráveis:",
        error,
      );

      setCentralLinks(null);
    }
  }

  async function loadAppearance() {
    try {
      const token =
        await shopify.sessionToken.get();

      const response = await fetch(
        `${APP_URL}/api/appearance?t=${Date.now()}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        },
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
            "Não foi possível carregar a aparência.",
        );
      }

      setAppearance(result.settings);

      console.log(
        "Aparência aplicada na Central:",
        result.settings,
      );
    } catch (error) {
      console.error(
        "Erro ao carregar aparência:",
        error,
      );

      setAppearance(null);
    }
  }

  const extensionAccountBackground =
    getAllowedSetting(
      settings?.account_background,
      ["transparent", "subdued", "base"],
      "transparent",
    );

  const extensionQuickCardBackground =
    getAllowedSetting(
      settings?.quick_card_background,
      ["transparent", "subdued", "base"],
      "transparent",
    );

  const extensionOrderCardBackground =
    getAllowedSetting(
      settings?.order_card_background,
      ["transparent", "subdued", "base"],
      "transparent",
    );

  const extensionNoticeTone =
    getAllowedSetting(
      settings?.notice_tone,
      ["info", "success", "warning", "critical"],
      "info",
    );

  const extensionNumberTone =
    getAllowedSetting(
      settings?.number_tone,
      ["auto", "neutral", "critical"],
      "auto",
    );

  const accountBackground =
    getAllowedSetting(
      appearance?.accountBackground,
      ["transparent", "subdued", "base"],
      extensionAccountBackground,
    );

  const quickCardBackground =
    getAllowedSetting(
      appearance?.quickCardBackground,
      ["transparent", "subdued", "base"],
      extensionQuickCardBackground,
    );

  const orderCardBackground =
    getAllowedSetting(
      appearance?.orderCardBackground,
      ["transparent", "subdued", "base"],
      extensionOrderCardBackground,
    );

  const noticeTone =
    getAllowedSetting(
      appearance?.noticeTone,
      ["info", "success", "warning", "critical"],
      extensionNoticeTone,
    );

  const numberTone =
    getAllowedSetting(
      appearance?.numberTone,
      ["auto", "neutral", "critical"],
      extensionNumberTone,
    );

  const badgeTone =
    numberTone === "auto"
      ? "info"
      : numberTone;

  const borderWidthOptions = [
    "base",
    "large",
    "large-100",
    "large-200",
  ];

  const borderRadiusOptions = [
    "none",
    "small",
    "base",
    "large",
    "max",
  ];

  const accountBorderWidth =
    getAllowedSetting(
      appearance?.accountBorderWidth,
      borderWidthOptions,
      getAllowedSetting(
        settings?.account_border_width,
        borderWidthOptions,
        "base",
      ),
    );

  const quickCardBorderWidth =
    getAllowedSetting(
      appearance?.quickCardBorderWidth,
      borderWidthOptions,
      getAllowedSetting(
        settings?.quick_card_border_width,
        borderWidthOptions,
        "base",
      ),
    );

  const orderCardBorderWidth =
    getAllowedSetting(
      appearance?.orderCardBorderWidth,
      borderWidthOptions,
      getAllowedSetting(
        settings?.order_card_border_width,
        borderWidthOptions,
        "base",
      ),
    );

  const accountBorderRadius =
    getAllowedSetting(
      appearance?.accountBorderRadius,
      borderRadiusOptions,
      getAllowedSetting(
        settings?.account_border_radius,
        borderRadiusOptions,
        "base",
      ),
    );

  const quickCardBorderRadius =
    getAllowedSetting(
      appearance?.quickCardBorderRadius,
      borderRadiusOptions,
      getAllowedSetting(
        settings?.quick_card_border_radius,
        borderRadiusOptions,
        "base",
      ),
    );

  const orderCardBorderRadius =
    getAllowedSetting(
      appearance?.orderCardBorderRadius,
      borderRadiusOptions,
      getAllowedSetting(
        settings?.order_card_border_radius,
        borderRadiusOptions,
        "base",
      ),
    );

  const accountUrl = buildUrl(
    "shopify:customer-account/orders",
  );
  const profileUrl = buildUrl(
    "shopify:customer-account/profile",
  );

  const customerName =
    getCustomerName(customer);

  const customerEmail =
    getCustomerEmail(customer);

  const customerPhone =
    getCustomerPhone(customer);

  const customerAddress =
    getCustomerAddress(customer);

  const quickCards = [
    {
      number: "01",
      title: "Meus pedidos",
      text: "Veja seus pedidos, status de pagamento e informações de entrega.",
      action: "Ver pedidos",
      path: "shopify:customer-account/orders",
    },
    {
      number: "02",
      title: "Minha conta",
      text: "Acesse a área oficial para gerenciar seus dados de conta.",
      action: "Abrir conta",
      path: "shopify:customer-account/profile",
    },
    {
      number: "03",
      title: "Endereços",
      text: "Gerencie os endereços salvos na sua conta.",
      action: "Gerenciar",
      path: "shopify:customer-account/profile",
    },
    {
      number: "04",
      title:
        centralLinks?.warrantyLabel ||
        "Garantia",
      text: "Consulte informações de garantia, suporte e assistência.",
      action: "Consultar",
      path:
        centralLinks?.warrantyUrl ||
        "/pages/garantia",
    },
    {
      number: "05",
      title:
        centralLinks?.supportLabel ||
        "Suporte",
      text: "Fale com a equipe da loja.",
      action: "Falar agora",
      path:
        centralLinks?.supportUrl ||
        "/pages/contato",
    },
    {
      number: "06",
      title:
        centralLinks?.appLabel ||
        "Aplicativo Fit",
      text: "Acesse informações sobre o app e configuração dos produtos.",
      action: "Ver app",
      path:
        centralLinks?.appUrl ||
        "/pages/aplicativo-fit",
    },
    {
      number: "07",
      title: "Cupons",
      text: "Consulte os cupons disponíveis na sua conta.",
      action: "Ver cupons",
      extensionHandle: "indique-e-ganhe",
    },
  ];

  const afterPurchase = [
    {
      title:
        centralLinks
          ?.installationGuideLabel ||
        "Guia de instalação",
      path:
        centralLinks
          ?.installationGuideUrl ||
        "/pages/guias-de-instalacao",
    },
    {
      title:
        centralLinks
          ?.warrantyRequestLabel ||
        "Acionar garantia",
      path:
        centralLinks
          ?.warrantyRequestUrl ||
        "/pages/garantia",
    },
    {
      title:
        centralLinks
          ?.contactSupportLabel ||
        "Falar com suporte",
      path:
        centralLinks
          ?.contactSupportUrl ||
        "/pages/contato",
    },
    {
      title:
        centralLinks?.policiesLabel ||
        "Ver políticas da loja",
      path:
        centralLinks?.policiesUrl ||
        "/pages/politicas",
    },
  ];

  return (
    <s-page
      title={`${CONFIG.labels.pageTitlePrefix} ${shopName}`}
    >
      <s-section>
        <s-stack gap="base">
          <s-text tone="subdued">
            {CONFIG.labels.areaLabel}
          </s-text>

          <s-heading>
            {CONFIG.labels.pageTitlePrefix}{" "}
            {shopName}
          </s-heading>

          <s-text>
            {CONFIG.labels.subtitle}
          </s-text>
        </s-stack>
      </s-section>

      <s-section>
        <s-grid
          gridTemplateColumns="1fr 2fr"
          gap="base"
        >
          <s-box
            padding="base"
            borderStyle="solid"
            borderWidth={accountBorderWidth}
            borderRadius={accountBorderRadius}
            background={accountBackground}
          >
            <s-stack gap="base">
              <s-heading>
                {CONFIG.labels.accountTitle}
              </s-heading>

              <s-text>
                {
                  CONFIG.labels
                    .accountDescriptionPrefix
                }{" "}
                {shopName}.
              </s-text>

              <s-divider />

              <s-stack gap="small">
                <s-text tone="subdued">
                  Nome
                </s-text>

                <s-text>
                  {customerLoading
                    ? "Carregando..."
                    : customerName ||
                      "Não informado"}
                </s-text>

                <s-text tone="subdued">
                  E-mail
                </s-text>

                <s-text>
                  {customerLoading
                    ? "Carregando..."
                    : customerEmail ||
                      "Não informado"}
                </s-text>

                <s-text tone="subdued">
                  Telefone
                </s-text>

                <s-text>
                  {customerLoading
                    ? "Carregando..."
                    : customerPhone ||
                      "Não informado"}
                </s-text>

                <s-text tone="subdued">
                  Endereço principal
                </s-text>

                <s-text>
                  {customerLoading
                    ? "Carregando..."
                    : customerAddress ||
                      "Não informado"}
                </s-text>

              </s-stack>

              {customerError ? (
                <s-banner tone="warning">
                  {customerError}
                </s-banner>
              ) : null}

              <s-button href={profileUrl}>
                Editar dados oficiais
              </s-button>

              <s-button href={accountUrl}>
                Acessar conta oficial
              </s-button>
            </s-stack>
          </s-box>

          <s-stack gap="base">
            <s-heading>
              Acesso rápido
            </s-heading>

            <s-grid
              gridTemplateColumns="1fr 1fr"
              gap="base"
            >
              {quickCards.map((card) => (
                <QuickCard
                  key={`${card.number}-${card.title}-${card.path || card.extensionHandle}`}
                  number={card.number}
                  title={card.title}
                  text={card.text}
                  action={card.action}
                  href={
                    card.path
                      ? buildUrl(card.path)
                      : null
                  }
                  extensionHandle={
                    card.extensionHandle
                  }
                  background={
                    quickCardBackground
                  }
                  borderWidth={
                    quickCardBorderWidth
                  }
                  borderRadius={
                    quickCardBorderRadius
                  }
                  badgeTone={badgeTone}
                />
              ))}
            </s-grid>

            <s-banner tone={noticeTone}>
              {
                CONFIG.labels
                  .securityNotice
              }
            </s-banner>
          </s-stack>
        </s-grid>
      </s-section>

      <s-section>
        <s-stack gap="base">
          <s-heading>
            Pedidos recentes
          </s-heading>

          {ordersLoading ? (
            <s-box
              padding="base"
              borderStyle="solid"
              borderWidth={
                orderCardBorderWidth
              }
              borderRadius={
                orderCardBorderRadius
              }
              background={
                orderCardBackground
              }
            >
              <s-text>
                Carregando pedidos...
              </s-text>
            </s-box>
          ) : ordersError ? (
            <s-banner tone="warning">
              {ordersError}
            </s-banner>
          ) : orders.length === 0 ? (
            <s-box
              padding="base"
              borderStyle="solid"
              borderWidth={
                orderCardBorderWidth
              }
              borderRadius={
                orderCardBorderRadius
              }
              background={
                orderCardBackground
              }
            >
              <s-text>
                Você ainda não possui pedidos
                recentes nesta conta.
              </s-text>
            </s-box>
          ) : (
            <s-stack gap="base">
              {orders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  background={
                    orderCardBackground
                  }
                  borderWidth={
                    orderCardBorderWidth
                  }
                  borderRadius={
                    orderCardBorderRadius
                  }
                />
              ))}
            </s-stack>
          )}
        </s-stack>
      </s-section>

      <s-section>
        <s-stack gap="base">
          <s-heading>
            Após a compra
          </s-heading>

          <s-grid
            gridTemplateColumns="1fr 1fr 1fr 1fr"
            gap="base"
          >
            {afterPurchase.map((item) => (
              <s-button
                key={`${item.title}-${item.path}`}
                href={buildUrl(item.path)}
              >
                {item.title}
              </s-button>
            ))}
          </s-grid>
        </s-stack>
      </s-section>
    </s-page>
  );
}

function QuickCard({
  number,
  title,
  text,
  action,
  href,
  extensionHandle,
  background,
  borderWidth,
  borderRadius,
  badgeTone,
}) {
  const actionHref = extensionHandle
    ? `extension:${extensionHandle}/`
    : href;

  return (
    <s-box
      padding="base"
      borderStyle="solid"
      borderWidth={borderWidth}
      borderRadius={borderRadius}
      background={background}
    >
      <s-stack gap="small">
        <s-badge tone={badgeTone}>
          {number}
        </s-badge>

        <s-heading>{title}</s-heading>

        <s-text>{text}</s-text>

        <s-link href={actionHref}>
          {action}
        </s-link>
      </s-stack>
    </s-box>
  );
}

function OrderCard({
  order,
  background,
  borderWidth,
  borderRadius,
}) {
  const date = formatDate(
    order?.processedAt,
  );

  return (
    <s-box
      padding="base"
      borderStyle="solid"
      borderWidth={borderWidth}
      borderRadius={borderRadius}
      background={background}
    >
      <s-stack gap="small">
        <s-heading>
          {order?.name || "Pedido"}
        </s-heading>

        <s-text>
          Data: {date}
        </s-text>

        <s-link
          href={buildUrl("/account")}
        >
          Ver detalhes do pedido
        </s-link>
      </s-stack>
    </s-box>
  );
}

function buildUrl(path) {
  if (!path) {
    return "/account";
  }

  if (
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("extension:") ||
    path.startsWith("shopify:customer-account/")
  ) {
    return path;
  }

  return path;
}

function getCustomerName(customer) {
  if (!customer) {
    return "";
  }

  const firstName =
    customer.firstName || "";

  const lastName =
    customer.lastName || "";

  return `${firstName} ${lastName}`.trim();
}

function getCustomerEmail(customer) {
  return (
    customer?.emailAddress
      ?.emailAddress || ""
  );
}

function getCustomerPhone(customer) {
  return (
    customer?.phoneNumber
      ?.phoneNumber || ""
  );
}

function getCustomerAddress(customer) {
  const formatted =
    customer?.defaultAddress?.formatted;

  if (!Array.isArray(formatted)) {
    return "";
  }

  return formatted
    .filter(Boolean)
    .join(", ");
}

function getAllowedSetting(
  value,
  allowedValues,
  fallback,
) {
  return allowedValues.includes(value)
    ? value
    : fallback;
}

function formatDate(value) {
  if (!value) {
    return "Não disponível";
  }

  try {
    return new Intl.DateTimeFormat(
      "pt-BR",
    ).format(new Date(value));
  } catch {
    return value;
  }
}