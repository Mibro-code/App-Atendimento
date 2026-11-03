import {
  consumeOlistOAuthState,
  exchangeOlistAuthorizationCode,
  saveOlistTokens,
} from "../services/olist-auth.server";

function htmlResponse(title, message, status = 200) {
  const body = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
      body {
        margin: 0;
        padding: 40px 20px;
        color: #202223;
        background: #f6f6f7;
        font-family: Arial, sans-serif;
      }
      main {
        max-width: 620px;
        margin: 0 auto;
        padding: 28px;
        background: #fff;
        border: 1px solid #e1e3e5;
        border-radius: 14px;
      }
      h1 { margin-top: 0; }
      p { line-height: 1.55; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;

  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

export async function loader({ request }) {
  const url = new URL(request.url);
  const authorizationError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (authorizationError) {
    return htmlResponse(
      "Autorização cancelada",
      "O Olist não autorizou a conexão. Nenhuma credencial foi armazenada.",
      400,
    );
  }

  if (!code || !state) {
    return htmlResponse(
      "Retorno inválido",
      "O retorno do Olist não incluiu o código e o estado esperados.",
      400,
    );
  }

  try {
    const shop = await consumeOlistOAuthState(state);
    const tokenData = await exchangeOlistAuthorizationCode(code);

    await saveOlistTokens(shop, tokenData);

    return htmlResponse(
      "Olist conectado",
      "A autorização foi concluída. Você pode fechar esta janela e voltar ao app Shopify.",
    );
  } catch (error) {
    console.error("Falha no callback OAuth do Olist", {
      name: error?.name,
      message: error?.message,
    });

    return htmlResponse(
      "Falha na conexão",
      "Não foi possível concluir a autorização. Verifique a configuração e tente novamente.",
      500,
    );
  }
}
