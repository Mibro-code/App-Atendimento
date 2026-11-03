import { handleCrmBridge } from "../services/crm-bridge-http.server";
import { resolveBridgeShop } from "../services/crm-order-bridge.server";
import { convertCrmProposal } from "../services/crm-proposal-bridge.server";
import { assertWholesaleOrderCreationAllowed } from "../services/wholesale-mode.server";

// CRM -> gera a venda nativa a partir da proposta (POST /orcamentos/{id}/venda).
// Respeita o "modo teste" do admin Shopify (bloqueia criação de pedidos).
export async function action({ request }) {
  return handleCrmBridge(request, async ({ body, brand }) => {
    const shop = await resolveBridgeShop();
    await assertWholesaleOrderCreationAllowed(shop);
    return convertCrmProposal(shop, body, brand);
  });
}
