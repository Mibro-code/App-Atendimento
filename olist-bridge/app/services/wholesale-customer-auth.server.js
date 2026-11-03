import db from "../db.server";
import { authenticate } from "../shopify.server";

export class WholesaleAccessError extends Error {
  constructor(message, { code = "WHOLESALE_ACCESS_DENIED", status = 403 } = {}) {
    super(message);
    this.name = "WholesaleAccessError";
    this.code = code;
    this.status = status;
  }
}

export async function requireWholesaleCustomer(request) {
  const { sessionToken, cors } =
    await authenticate.public.customerAccount(request);
  const shop = sessionToken?.dest?.toLowerCase();
  const shopifyCustomerId = sessionToken?.sub;

  if (!shop || !shopifyCustomerId) {
    throw new WholesaleAccessError("Cliente nao autenticado.", {
      code: "WHOLESALE_AUTH_REQUIRED",
      status: 401,
    });
  }

  const customer = await db.wholesaleCustomer.findUnique({
    where: {
      shop_shopifyCustomerId: {
        shop,
        shopifyCustomerId,
      },
    },
    include: {
      companies: {
        where: {
          active: true,
          company: {
            active: true,
          },
        },
        include: {
          company: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!customer?.active || customer.companies.length === 0) {
    throw new WholesaleAccessError(
      "Sua conta ainda nao esta vinculada a uma empresa de atacado.",
      { code: "WHOLESALE_COMPANY_NOT_LINKED" },
    );
  }

  return {
    shop,
    shopifyCustomerId,
    customer,
    memberships: customer.companies,
    companyIds: customer.companies.map(({ companyId }) => companyId),
    cors,
  };
}
