import { handleCrmBridge } from "../services/crm-bridge-http.server";
import { resolveBridgeShop } from "../services/crm-order-bridge.server";
import { setCrmProposalSituation } from "../services/crm-proposal-bridge.server";

// CRM -> atualiza a situação da proposta no Olist (opcional, desligado no CRM por padrão).
export async function action({ request }) {
  return handleCrmBridge(request, async ({ body, brand }) => {
    const shop = await resolveBridgeShop();
    return setCrmProposalSituation(shop, body, brand);
  });
}
