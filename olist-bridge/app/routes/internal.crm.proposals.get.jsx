import { handleCrmBridge } from "../services/crm-bridge-http.server";
import { resolveBridgeShop } from "../services/crm-order-bridge.server";
import { getCrmProposal } from "../services/crm-proposal-bridge.server";

// CRM -> lê a proposta no Olist (somente leitura).
export async function action({ request }) {
  return handleCrmBridge(request, async ({ body, brand }) => {
    const shop = await resolveBridgeShop();
    return getCrmProposal(shop, body, brand);
  });
}
