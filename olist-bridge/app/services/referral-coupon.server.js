import {randomBytes} from "node:crypto";

import db from "../db.server";

function getCustomerName(customer) {
  return (
    customer?.displayName ||
    [customer?.firstName, customer?.lastName]
      .filter(Boolean)
      .join(" ") ||
    "Cliente"
  );
}

function generateReferralCode(name) {
  const cleanName = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 12);

  const randomPart = randomBytes(4)
    .toString("hex")
    .toUpperCase();

  return `INDICA-${cleanName || "CLIENTE"}-${randomPart}`;
}

function buildDiscountValue(settings) {
  const value = Number(
    settings?.referralDiscountValue ?? 15,
  );

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      "O valor do desconto de indica\u00e7\u00e3o precisa ser maior que zero.",
    );
  }

  if (settings?.referralDiscountType === "FIXED_AMOUNT") {
    return {
      discountAmount: {
        amount: String(value),
        appliesOnEachItem: false,
      },
    };
  }

  if (value > 100) {
    throw new Error(
      "O desconto percentual n\u00e3o pode ser maior que 100%.",
    );
  }

  return {
    percentage: value / 100,
  };
}

function getDurationDays(settings) {
  const value = Number(
    settings?.referralDurationDays ?? 30,
  );

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      "A dura\u00e7\u00e3o do cupom precisa ser de pelo menos um dia.",
    );
  }

  return value;
}

function getMinimumPurchase(settings) {
  const value = Number(
    settings?.referralMinimumPurchase ?? 0,
  );

  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getUsageLimit(settings) {
  const value = settings?.referralTotalUsageLimit;

  if (value === null || value === undefined) {
    return undefined;
  }

  const numericValue = Number(value);

  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : undefined;
}

async function removeDiscount(admin, id) {
  if (!id) return;

  try {
    await admin.graphql(
      `#graphql
        mutation DeleteReferralDiscount($id: ID!) {
          discountCodeDelete(id: $id) {
            deletedCodeDiscountId
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          id,
        },
      },
    );
  } catch (error) {
    console.error(
      "N\u00e3o foi poss\u00edvel remover o desconto duplicado:",
      error,
    );
  }
}

export async function getReferralCustomer({
  admin,
  customerId,
}) {
  const response = await admin.graphql(
    `#graphql
      query GetReferralCustomer($id: ID!) {
        customer(id: $id) {
          id
          displayName
          firstName
          lastName
          email
        }
      }
    `,
    {
      variables: {
        id: customerId,
      },
    },
  );

  const responseJson = await response.json();
  const customer = responseJson.data?.customer;

  if (!customer) {
    throw new Error(
      "O cliente autenticado n\u00e3o foi encontrado.",
    );
  }

  return customer;
}

export async function createReferralCouponForCustomer({
  admin,
  shop,
  customer,
}) {
  if (!shop || !customer?.id) {
    throw new Error(
      "Loja ou cliente n\u00e3o identificado.",
    );
  }

  const existingCoupon = await db.referralCoupon.findUnique(
    {
      where: {
        shop_customerId: {
          shop,
          customerId: customer.id,
        },
      },
    },
  );

  if (existingCoupon) {
    return {
      created: false,
      coupon: existingCoupon,
    };
  }

  const settings = await db.couponSettings.findUnique({
    where: {
      shop,
    },
  });

  const customerName = getCustomerName(customer);
  const customerEmail = customer.email || null;
  const code = generateReferralCode(customerName);
  const startsAt = new Date();
  const endsAt = new Date(startsAt);

  endsAt.setDate(
    endsAt.getDate() + getDurationDays(settings),
  );

  const minimumPurchase = getMinimumPurchase(settings);

  const discountResponse = await admin.graphql(
    `#graphql
      mutation CreateReferralDiscount(
        $basicCodeDiscount: DiscountCodeBasicInput!
      ) {
        discountCodeBasicCreate(
          basicCodeDiscount: $basicCodeDiscount
        ) {
          codeDiscountNode {
            id
          }

          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        basicCodeDiscount: {
          title: `Indica\u00e7\u00e3o de ${customerName}`,
          code,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),

          context: {
            all: "ALL",
          },

          customerGets: {
            value: buildDiscountValue(settings),
            items: {
              all: true,
            },
          },

          minimumRequirement:
            minimumPurchase > 0
              ? {
                  subtotal: {
                    greaterThanOrEqualToSubtotal:
                      String(minimumPurchase),
                  },
                }
              : undefined,

          appliesOncePerCustomer:
            (settings?.referralUsageLimitPerCustomer ??
              1) === 1,

          usageLimit: getUsageLimit(settings),

          combinesWith: {
            orderDiscounts:
              settings?.referralCombinesOrderDiscount ??
              false,
            productDiscounts:
              settings?.referralCombinesProductDiscount ??
              false,
            shippingDiscounts:
              settings?.referralCombinesShipping ?? false,
          },
        },
      },
    },
  );

  const discountJson = await discountResponse.json();

  const result = discountJson.data?.discountCodeBasicCreate;

  const userErrors = result?.userErrors ?? [];

  if (userErrors.length > 0) {
    throw new Error(
      userErrors.map((error) => error.message).join(" | "),
    );
  }

  const shopifyDiscountId = result?.codeDiscountNode?.id;

  if (!shopifyDiscountId) {
    throw new Error(
      "A Shopify n\u00e3o retornou o ID do desconto.",
    );
  }

  try {
    const coupon = await db.referralCoupon.create({
      data: {
        shop,
        customerId: customer.id,
        customerEmail,
        customerName,
        code,
        shopifyDiscountId,
        startsAt,
        endsAt,
      },
    });

    return {
      created: true,
      coupon,
    };
  } catch (error) {
    const concurrentCoupon =
      await db.referralCoupon.findUnique({
        where: {
          shop_customerId: {
            shop,
            customerId: customer.id,
          },
        },
      });

    await removeDiscount(admin, shopifyDiscountId);

    if (concurrentCoupon) {
      return {
        created: false,
        coupon: concurrentCoupon,
      };
    }

    throw error;
  }
}
