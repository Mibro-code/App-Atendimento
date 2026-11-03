import { handleCrmBridge } from "../services/crm-bridge-http.server";
import { calculateCrmOrder, resolveBridgeShop } from "../services/crm-order-bridge.server";
import { assertWholesaleOrderCreationAllowed } from "../services/wholesale-mode.server";

// CRM -> cria/atualiza o pedido em aberto no Olist com os preços validados pelo CRM.
// Respeita o "modo teste" do admin Shopify (bloqueia criação de pedidos).
export async function action({ request }) {
  return handleCrmBridge(request, async ({ body, brand }) => {
    const shop = await resolveBridgeShop();
    await assertWholesaleOrderCreationAllowed(shop);
    return calculateCrmOrder(shop, body, brand);
  });
}
