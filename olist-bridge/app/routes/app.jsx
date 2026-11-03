import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app/wholesale-access">Acessos Atacado</s-link>
        <s-link href="/app/central-links">Links da Central</s-link>
        <s-link href="/app">Home</s-link>

        <s-link href="/app/additional">Configurações de cupons</s-link>

        <s-link href="/app/referrals">Cupons de recompensa</s-link>

        <s-link href="/app/olist">Integração Olist</s-link>
      </s-app-nav>

      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses,
// so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
