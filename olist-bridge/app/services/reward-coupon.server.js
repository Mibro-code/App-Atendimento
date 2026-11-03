import { randomBytes } from "node:crypto";

import db from "../db.server";

function getCustomerName(customer) {
  return (
    customer?.displayName ||
    [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") ||
    "Cliente"
  );
}

function generateRewardCode(name, maxLength = 12) {
  const cleanName = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, maxLength);

  const randomPart = randomBytes(4).toString("hex").toUpperCase();

  return `RECOMPENSA-${cleanName || "CLIENTE"}-${randomPart}`;
}

function getDiscountValue(discountType, discountValue) {
  const value = Number(discountValue);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      "O valor do cupom de recompensa precisa ser maior que zero.",
    );
  }

  if (discountType === "FIXED_AMOUNT") {
    return {
      discountAmount: {
        amount: String(value),
        appliesOnEachItem: false,
      },
    };
  }

  if (value > 100) {
    throw new Error("O desconto percentual não pode ser maior que 100%.");
  }

  return { percentage: value / 100 };
}

function getDiscountType(value) {
  const discountType = String(value || "PERCENTAGE").toUpperCase();

  if (!["PERCENTAGE", "FIXED_AMOUNT"].includes(discountType)) {
    throw new Error("O tipo de desconto da recompensa \u00e9 inv\u00e1lido.");
  }

  return discountType;
}

function getCustomerEligibility(value) {
  const customerEligibility = String(value || "OWNER_ONLY").toUpperCase();

  if (!["OWNER_ONLY", "ALL_CUSTOMERS"].includes(customerEligibility)) {
    throw new Error("O p\u00fablico do cupom de recompensa \u00e9 inv\u00e1lido.");
  }

  return customerEligibility;
}

function getPositiveInteger(value, fallback, fieldName) {
  const number = Number(value ?? fallback);

  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${fieldName} precisa ser de pelo menos 1.`);
  }

  return number;
}

function getMinimumPurchase(settings) {
  const value = Number(settings?.rewardMinimumPurchase ?? 0);

  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function removeDiscount(admin, id) {
  if (!id) return;

  try {
    await admin.graphql(
      `#graphql
        mutation DeleteRewardDiscount($id: ID!) {
          discountCodeDelete(id: $id) {
            deletedCodeDiscountId
            userErrors {
              field
              message
            }
          }
        }
      `,
      { variables: { id } },
    );
  } catch (error) {
    console.error("Não foi possível remover o desconto de recompensa:", error);
  }
}

export async function createRewardCouponForCustomer({
  admin,
  shop,
  customer,
  referralUseId = null,
  couponOptions = null,
}) {
  if (!shop || !customer?.id) {
    throw new Error("Loja ou cliente não identificado.");
  }

  const settings = await db.couponSettings.findUnique({
    where: { shop },
  });

  const discountType = getDiscountType(
    couponOptions?.discountType ?? settings?.rewardDiscountType,
  );
  const discountValue = Number(
    couponOptions?.discountValue ?? settings?.rewardDiscountValue ?? 10,
  );

  const customerName = getCustomerName(customer);
  const couponName = String(couponOptions?.couponName || "").trim();
  const code = generateRewardCode(
    couponName || customerName,
    couponName ? 24 : 12,
  );
  const startsAt = new Date();
  const endsAt = new Date(startsAt);
  const durationDays = getPositiveInteger(
    couponOptions?.durationDays ?? settings?.rewardDurationDays,
    30,
    "A duração da recompensa",
  );
  const usageLimit = getPositiveInteger(
    couponOptions?.usageLimit ?? settings?.rewardUsageLimit,
    1,
    "O limite de uso da recompensa",
  );
  const customerEligibility = getCustomerEligibility(
    couponOptions?.customerEligibility ??
      ((settings?.rewardCreatorExclusive ?? true)
        ? "OWNER_ONLY"
        : "ALL_CUSTOMERS"),
  );
  const appliesOncePerCustomer =
    typeof couponOptions?.appliesOncePerCustomer === "boolean"
      ? couponOptions.appliesOncePerCustomer
      : usageLimit === 1;
  const minimumPurchase = getMinimumPurchase(settings);

  // Valida o valor antes de enviar qualquer mutacao a Shopify.
  const customerGetsValue = getDiscountValue(
    discountType,
    discountValue,
  );

  endsAt.setDate(endsAt.getDate() + durationDays);

  const discountResponse = await admin.graphql(
    `#graphql
      mutation CreateRewardDiscount(
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
          title: couponName
            ? `${couponName} - ${customerName}`
            : `Recompensa de ${customerName}`,
          code,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          context:
            customerEligibility === "OWNER_ONLY"
              ? { customers: { add: [customer.id] } }
              : { all: "ALL" },
          customerGets: {
            value: customerGetsValue,
            items: { all: true },
          },
          minimumRequirement:
            minimumPurchase > 0
              ? {
                  subtotal: {
                    greaterThanOrEqualToSubtotal: String(minimumPurchase),
                  },
                }
              : undefined,
          appliesOncePerCustomer,
          usageLimit,
          combinesWith: {
            orderDiscounts: settings?.rewardCombinesOrderDiscount ?? false,
            productDiscounts: settings?.rewardCombinesProductDiscount ?? false,
            shippingDiscounts: settings?.rewardCombinesShipping ?? false,
          },
        },
      },
    },
  );

  const discountJson = await discountResponse.json();
  const result = discountJson.data?.discountCodeBasicCreate;
  const userErrors = result?.userErrors ?? [];

  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join(" | "));
  }

  const shopifyDiscountId = result?.codeDiscountNode?.id;

  if (!shopifyDiscountId) {
    throw new Error("A Shopify não retornou o ID da recompensa.");
  }

  try {
    return await db.rewardCoupon.create({
      data: {
        shop,
        referralUseId,
        ownerCustomerId: customer.id,
        ownerEmail: customer.email || null,
        code,
        shopifyDiscountId,
        status: "ACTIVE",
        usageLimit,
        discountType,
        discountValue,
        couponName: couponName || null,
        durationDays,
        customerEligibility,
        appliesOncePerCustomer,
        startsAt,
        endsAt,
      },
    });
  } catch (error) {
    await removeDiscount(admin, shopifyDiscountId);
    throw error;
  }
}
