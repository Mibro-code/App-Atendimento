import { handleCrmBridge } from "../services/crm-bridge-http.server";
import { confirmCrmOrder, resolveBridgeShop } from "../services/crm-order-bridge.server";
import { assertWholesaleOrderCreationAllowed } from "../services/wholesale-mode.server";

// CRM -> mantém o pedido aberto e marca PARA ANÁLISE (aprovação manual no Olist).
export async function action({ request }) {
  return handleCrmBridge(request, async ({ body }) => {
    const shop = await resolveBridgeShop();
    await assertWholesaleOrderCreationAllowed(shop);
    return confirmCrmOrder(shop, body);
  });
}
