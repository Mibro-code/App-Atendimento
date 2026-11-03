export function normalizeCnpj(value) {
  const normalized = String(value ?? "").replace(/\D/g, "");

  if (normalized.length !== 14) {
    return null;
  }

  return normalized;
}

function calculateCheckDigit(base) {
  let weight = base.length - 7;
  let total = 0;

  for (const digit of base) {
    total += Number(digit) * weight;
    weight -= 1;
    if (weight === 1) weight = 9;
  }

  const remainder = total % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCnpj(value) {
  const normalized = normalizeCnpj(value);

  if (!normalized || /^(\d)\1{13}$/.test(normalized)) {
    return false;
  }

  const firstDigit = calculateCheckDigit(normalized.slice(0, 12));
  const secondDigit = calculateCheckDigit(
    `${normalized.slice(0, 12)}${firstDigit}`,
  );

  return normalized.endsWith(`${firstDigit}${secondDigit}`);
}

export function requireValidCnpj(value) {
  const normalized = normalizeCnpj(value);

  if (!normalized || !isValidCnpj(normalized)) {
    throw new Error("CNPJ invalido.");
  }

  return normalized;
}

export function formatCnpj(value) {
  const normalized = normalizeCnpj(value);

  if (!normalized) return "";

  return normalized.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5",
  );
}

export function maskCnpj(value) {
  const normalized = normalizeCnpj(value);

  if (!normalized) return "**.***.***/****-**";

  return `${normalized.slice(0, 2)}.***.***/${normalized.slice(8, 12)}-**`;
}
