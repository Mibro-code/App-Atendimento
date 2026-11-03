import db from "../db.server";
import { requireValidCnpj } from "../utils/cnpj";
import {
  generateTemporaryPassword,
  hashWholesalePassword,
  validateWholesalePassword,
} from "./wholesale-password.server";

function requiredText(value, label, maxLength = 180) {
  const text = typeof value === "string" ? value.trim() : "";

  if (!text) throw new Error(`${label} e obrigatorio.`);
  if (text.length > maxLength) throw new Error(`${label} e muito longo.`);

  return text;
}

function optionalText(value, maxLength = 180) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.length > maxLength) throw new Error("Um dos campos e muito longo.");
  return text;
}

function normalizeEmail(value) {
  const email = requiredText(value, "E-mail", 254).toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Informe um e-mail valido.");
  }

  return email;
}

export async function createWholesaleAccess({ shop, input }) {
  const cnpj = requireValidCnpj(input.cnpj);
  const legalName = requiredText(input.legalName, "Razao social");
  const tradeName = optionalText(input.tradeName);
  const name = requiredText(input.name, "Nome da pessoa");
  const emailNormalized = normalizeEmail(input.email);
  const olistCustomerId = optionalText(input.olistCustomerId, 120);
  const temporaryPassword = input.temporaryPassword?.trim()
    ? validateWholesalePassword(input.temporaryPassword.trim())
    : generateTemporaryPassword();
  const passwordHash = await hashWholesalePassword(temporaryPassword);

  const result = await db.$transaction(async (transaction) => {
    const company = await transaction.wholesaleCompany.upsert({
      where: { shop_cnpj: { shop, cnpj } },
      create: {
        shop,
        cnpj,
        legalName,
        tradeName,
        olistCustomerId,
      },
      update: {
        legalName,
        tradeName,
        ...(olistCustomerId ? { olistCustomerId } : {}),
        active: true,
      },
    });

    const existingCustomer = await transaction.wholesaleCustomer.findUnique({
      where: { shop_emailNormalized: { shop, emailNormalized } },
      include: { credential: { select: { id: true } } },
    });

    if (existingCustomer?.credential) {
      throw new Error(
        "Esse e-mail ja possui acesso. Use a opcao de gerar nova senha temporaria.",
      );
    }

    const customer = existingCustomer
      ? await transaction.wholesaleCustomer.update({
          where: { id: existingCustomer.id },
          data: { name, email: emailNormalized, active: true },
        })
      : await transaction.wholesaleCustomer.create({
          data: {
            shop,
            name,
            email: emailNormalized,
            emailNormalized,
          },
        });

    await transaction.wholesaleCustomerCompany.upsert({
      where: {
        customerId_companyId: {
          customerId: customer.id,
          companyId: company.id,
        },
      },
      create: { customerId: customer.id, companyId: company.id },
      update: { active: true },
    });

    await transaction.wholesaleCredential.create({
      data: {
        customerId: customer.id,
        passwordHash,
        mustChangePassword: true,
      },
    });

    return { company, customer };
  });

  return { ...result, temporaryPassword };
}

export async function resetWholesaleTemporaryPassword({ shop, customerId }) {
  const customer = await db.wholesaleCustomer.findFirst({
    where: { id: customerId, shop },
    include: { credential: { select: { id: true } } },
  });

  if (!customer?.credential) throw new Error("Acesso atacadista nao encontrado.");

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashWholesalePassword(temporaryPassword);

  await db.wholesaleCredential.update({
    where: { customerId },
    data: {
      passwordHash,
      mustChangePassword: true,
      failedAttempts: 0,
      lockedUntil: null,
      passwordChangedAt: null,
    },
  });

  return { customer, temporaryPassword };
}

export async function setWholesaleAccessActive({ shop, customerId, active }) {
  const result = await db.wholesaleCustomer.updateMany({
    where: { id: customerId, shop },
    data: { active },
  });

  if (result.count !== 1) throw new Error("Acesso atacadista nao encontrado.");
}
