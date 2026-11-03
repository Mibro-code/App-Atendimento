import { WholesaleAccessError } from "./wholesale-customer-auth.server";

export function wholesaleCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "private, no-store",
    Vary: "Origin",
  };
}

export function wholesaleOptionsResponse() {
  return new Response(null, {
    status: 204,
    headers: wholesaleCorsHeaders(),
  });
}

export function wholesaleJson(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      ...wholesaleCorsHeaders(),
      ...(init.headers || {}),
    },
  });
}

export function wholesaleErrorResponse(error) {
  if (error instanceof WholesaleAccessError) {
    return wholesaleJson(
      {
        success: false,
        code: error.code,
        message: error.message,
      },
      { status: error.status },
    );
  }

  console.error("[WHOLESALE] Falha ao processar a solicitacao.", error);

  return wholesaleJson(
    {
      success: false,
      code: "WHOLESALE_TEMPORARY_ERROR",
      message: "A Central Atacado esta temporariamente indisponivel.",
    },
    { status: 500 },
  );
}
