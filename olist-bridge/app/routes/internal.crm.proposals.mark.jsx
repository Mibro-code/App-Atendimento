import { handleCrmBridge } from "../services/crm-bridge-http.server";
import { resolveBridgeShop } from "../services/crm-order-bridge.server";
import { markCrmProposal } from "../services/crm-proposal-bridge.server";

// CRM -> adiciona marcador informativo à proposta no Olist.
export async function action({ request }) {
  return handleCrmBridge(request, async ({ body, brand }) => {
    const shop = await resolveBridgeShop();
    return markCrmProposal(shop, body, brand);
  });
}
