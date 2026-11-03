import { handleCrmBridge } from "../services/crm-bridge-http.server";
import { sendCrmProposalEmail } from "../services/crm-proposal-email.server";

// CRM -> envia a proposta (simulação) por e-mail ao cliente, com cópia interna.
export async function action({ request }) {
  return handleCrmBridge(request, ({ body, brand }) => sendCrmProposalEmail(body, brand));
}
