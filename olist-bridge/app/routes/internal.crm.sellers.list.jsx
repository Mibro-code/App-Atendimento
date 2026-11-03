import { handleCrmBridge } from "../services/crm-bridge-http.server";
import { resolveBridgeShop } from "../services/crm-order-bridge.server";
import { listCrmSellers } from "../services/crm-proposal-bridge.server";

// CRM -> lista os vendedores cadastrados no Olist (para o vínculo de vendedores).
export async function action({ request }) {
  return handleCrmBridge(request, async ({ body, brand }) => {
    const shop = await resolveBridgeShop();
    return listCrmSellers(shop, body, brand);
  });
}
