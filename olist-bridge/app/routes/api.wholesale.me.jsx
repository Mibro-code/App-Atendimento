import {
  requireWholesaleCustomer,
} from "../services/wholesale-customer-auth.server";
import {
  wholesaleErrorResponse,
  wholesaleJson,
  wholesaleOptionsResponse,
} from "../services/wholesale-api-response.server";
import { formatCnpj } from "../utils/cnpj";

export async function loader({ request }) {
  if (request.method === "OPTIONS") return wholesaleOptionsResponse();

  try {
    const { customer, memberships } =
      await requireWholesaleCustomer(request);

    return wholesaleJson({
      success: true,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
      },
      companies: memberships.map(({ company, role }) => ({
        id: company.id,
        legalName: company.legalName,
        tradeName: company.tradeName,
        cnpj: company.cnpj,
        formattedCnpj: formatCnpj(company.cnpj),
        role,
        lastSyncedAt: company.lastSyncedAt,
      })),
    });
  } catch (error) {
    return wholesaleErrorResponse(error);
  }
}
