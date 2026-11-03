import { handleCrmBridge } from "../services/crm-bridge-http.server";
import { resolveBridgeShop } from "../services/crm-order-bridge.server";
import { inspectCrmOrder } from "../services/crm-proposal-bridge.server";

// CRM -> consulta pedido e contas a receber da venda (somente leitura).
export async function action({ request }) {
  return handleCrmBridge(request, async ({ body, brand }) => {
    const shop = await resolveBridgeShop();
    return inspectCrmOrder(shop, body, brand);
  });
}
