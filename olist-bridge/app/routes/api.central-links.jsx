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

function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "no-store",
  };
}

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(),
    });
  }

  try {
    const { sessionToken } =
      await authenticate.public.customerAccount(request);

    const shop = sessionToken?.dest;

    if (!shop) {
      return Response.json(
        {
          success: false,
          message: "Loja não identificada.",
        },
        {
          status: 401,
          headers: getCorsHeaders(),
        },
      );
    }

    const settings =
      await db.centralLinkSettings.findUnique({
        where: {
          shop,
        },
      });

    return Response.json(
      {
        success: true,
        settings: settings ?? DEFAULT_LINKS,
      },
      {
        status: 200,
        headers: getCorsHeaders(),
      },
    );
  } catch (error) {
    console.error(
      "Erro ao carregar links da Central:",
      error,
    );

    return Response.json(
      {
        success: false,
        message:
          "Não foi possível carregar os links da Central.",
      },
      {
        status: 500,
        headers: getCorsHeaders(),
      },
    );
  }
}