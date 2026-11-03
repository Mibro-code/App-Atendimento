import {
  wholesaleErrorResponse,
  wholesaleJson,
  wholesaleOptionsResponse,
} from "../services/wholesale-api-response.server";
import { requireWholesaleCustomer } from "../services/wholesale-customer-auth.server";
import { listWholesalePurchasedProducts } from "../services/wholesale-profile-read.server";

export async function loader({ request }) {
  if (request.method === "OPTIONS") return wholesaleOptionsResponse();

  try {
    const { shop, companyIds } = await requireWholesaleCustomer(request);
    const products = await listWholesalePurchasedProducts({ shop, companyIds });
    return wholesaleJson({ success: true, products });
  } catch (error) {
    return wholesaleErrorResponse(error);
  }
}
