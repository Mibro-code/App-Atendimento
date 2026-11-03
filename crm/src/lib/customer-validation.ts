// Helpers Zod reutilizáveis para o cadastro/edição de cliente (Customer).
// Regra central do formulário: só o nome do contato é obrigatório — todo o
// resto é opcional. Inputs HTML sempre mandam "" para um campo vazio (nunca
// undefined), e um `.optional()` do Zod sozinho NÃO aceita "" — cada helper
// aqui trata "" como "campo vazio" (null) antes de validar o formato, para
// nunca rejeitar um campo opcional só por estar vazio.
//
// "" vira `null`, não `undefined`, de propósito: no PATCH de edição
// (/api/customers/[id]), `undefined` significa "campo ausente do payload,
// não mexer no valor já salvo" e `null` significa "campo enviado vazio,
// limpar o valor salvo". Só a chave literalmente ausente do JSON continua
// undefined (nenhum dos formulários hoje omite chaves, mas o schema respeita
// os dois casos corretamente).
import { z } from "zod";
import { onlyDigits } from "./format";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Mesma faixa usada na importação por planilha (customer-import.ts): DDD (2)
// + número (8 ou 9 dígitos), com folga para DDI opcional na digitação.
const PHONE_MIN_DIGITS = 10;
const PHONE_MAX_DIGITS = 13;

function blankToNull(value: unknown): unknown {
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}

// Nome do contato: único campo obrigatório do formulário. Trim primeiro —
// "   " (só espaços) nunca deve passar como nome válido.
export const requiredContactName = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z.string().min(1, "Informe o nome do cliente.")
);

// Texto opcional: "" vira ausência de valor, nunca dispara erro de formato.
export function optionalString(maxLength?: number) {
  let schema = z.string().trim();
  if (maxLength) schema = schema.max(maxLength, `Deve ter no máximo ${maxLength} caracteres.`);
  return z.preprocess(blankToNull, schema.optional().nullable());
}

// Enum opcional (ex.: businessType, interestedBrand): o <select> do
// formulário manda "" para "não selecionado" — sem este preprocess, o Zod
// rejeita "" por não ser um valor do enum, mesmo o campo sendo opcional.
// `const T` (TS 5.0+) infere a união literal a partir do array passado na
// chamada sem precisar de `as const` em cada call site, então o retorno bate
// exatamente com o enum do Prisma (BusinessType, CustomerInterestedBrand),
// em vez de desmanchar para `string | null | undefined`.
export function optionalEnum<const T extends readonly [string, ...string[]]>(values: T, invalidMessage: string) {
  return z.preprocess(
    blankToNull,
    z.enum(values, { errorMap: () => ({ message: invalidMessage }) })
      .optional()
      .nullable()
  );
}

export function optionalEmail() {
  return z.preprocess(
    blankToNull,
    z.string().trim()
      .regex(EMAIL_PATTERN, "Informe um e-mail válido, por exemplo: nome@empresa.com.br.")
      .optional()
      .nullable()
  );
}

// "" (campo realmente vazio) vira null e pula a validação de formato. Um
// valor digitado sem NENHUM dígito (ex.: "abc") não pode virar null por
// onlyDigits() também dar "" — isso escondia erro nenhum (CASO 6: telefone
// "abc" passava como se estivesse vazio). Só o texto ORIGINAL vazio conta
// como ausência; "abc" vira dígitos "" mesmo, que falha no length abaixo.
function digitsOrNull(value: unknown): unknown {
  if (typeof value !== "string") return blankToNull(value);
  if (value.trim() === "") return null;
  return onlyDigits(value);
}

export function optionalCpf() {
  return z.preprocess(
    digitsOrNull,
    z.string().length(11, "Informe um CPF válido com 11 dígitos.").optional().nullable()
  );
}

export function optionalCnpj() {
  return z.preprocess(
    digitsOrNull,
    z.string().length(14, "Informe um CNPJ válido com 14 dígitos.").optional().nullable()
  );
}

export function optionalPhone() {
  return z.preprocess(
    digitsOrNull,
    z.string()
      .min(PHONE_MIN_DIGITS, "Informe um telefone válido com DDD.")
      .max(PHONE_MAX_DIGITS, "Informe um telefone válido com DDD.")
      .optional()
      .nullable()
  );
}
