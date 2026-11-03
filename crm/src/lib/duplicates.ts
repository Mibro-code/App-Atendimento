import { prisma } from "@/lib/prisma";
import { onlyDigits, normalizeEmail } from "@/lib/format";
import type { Prisma } from "@prisma/client";

export interface DuplicateCheckInput {
  cnpjDigits?: string | null;
  cpfDigits?: string | null;
  email?: string | null;
  phoneDigits?: string | null;
  excludeCustomerId?: string;
  scope?: Prisma.CustomerWhereInput;
}

/**
 * Verifica possíveis clientes duplicados por CNPJ, CPF, e-mail ou telefone
 * (todos normalizados). Não bloqueia a criação — apenas retorna os
 * candidatos para que a API sinalize ao frontend, que deve pedir
 * confirmação explícita do usuário antes de criar mesmo assim.
 */
export async function findPossibleDuplicates(input: DuplicateCheckInput) {
  const cnpj = onlyDigits(input.cnpjDigits);
  const cpf = onlyDigits(input.cpfDigits);
  const email = normalizeEmail(input.email);
  const phone = onlyDigits(input.phoneDigits);

  const or: Array<Record<string, unknown>> = [];
  if (cnpj) or.push({ cnpjDigits: cnpj });
  if (cpf) or.push({ cpfDigits: cpf });
  if (email) or.push({ email });
  if (phone) or.push({ phoneDigits: phone });

  if (or.length === 0) return [];

  const matches = await prisma.customer.findMany({
    where: {
      ...input.scope,
      OR: or,
      ...(input.excludeCustomerId ? { NOT: { id: input.excludeCustomerId } } : {}),
    },
    select: {
      id: true,
      contactName: true,
      legalName: true,
      tradeName: true,
      cnpjDigits: true,
      cpfDigits: true,
      email: true,
      phoneDigits: true,
      sellerId: true,
      seller: { select: { name: true } },
    },
    take: 10,
  });

  return matches;
}
