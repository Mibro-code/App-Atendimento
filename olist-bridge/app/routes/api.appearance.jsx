import db from "../db.server";
import {authenticate} from "../shopify.server";

const DEFAULT_APPEARANCE = {
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

function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type",
    "Access-Control-Allow-Methods":
      "GET, OPTIONS",
    "Cache-Control":
      "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function normalizeShop(value) {
  if (
    !value ||
    typeof value !== "string"
  ) {
    return "";
  }

  return value
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

export async function loader({request}) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(),
    });
  }

  try {
    const {sessionToken} =
      await authenticate.public.customerAccount(
        request,
      );

    const shop = normalizeShop(
      sessionToken?.dest,
    );

    if (!shop) {
      return Response.json(
        {
          success: false,
          message:
            "Não foi possível identificar a loja.",
        },
        {
          status: 401,
          headers: getCorsHeaders(),
        },
      );
    }

    const storedSettings =
      await db.appearanceSettings.findUnique({
        where: {
          shop,
        },

        select: {
          accountBackground: true,
          quickCardBackground: true,
          orderCardBackground: true,

          noticeTone: true,
          numberTone: true,

          accountBorderWidth: true,
          quickCardBorderWidth: true,
          orderCardBorderWidth: true,

          accountBorderRadius: true,
          quickCardBorderRadius: true,
          orderCardBorderRadius: true,
        },
      });

    const settings = {
      ...DEFAULT_APPEARANCE,
      ...(storedSettings || {}),
    };

    console.log(
      "Aparência enviada para a Central:",
      {
        shop,
        settings,
      },
    );

    return Response.json(
      {
        success: true,
        shop,
        settings,
      },
      {
        status: 200,
        headers: getCorsHeaders(),
      },
    );
  } catch (error) {
    console.error(
      "Erro na API de aparência:",
      error,
    );

    return Response.json(
      {
        success: false,
        message:
          "Não foi possível carregar a aparência.",
      },
      {
        status: 500,
        headers: getCorsHeaders(),
      },
    );
  }
}