import { onlyDigits } from "./format";
export const PHONE_CHANNELS = ["PHONE", "WHATSAPP", "WHATSAPP_BUSINESS"] as const;
export const PHONE_CHANNEL_LABELS: Record<string, string> = { PHONE: "Somente telefone", WHATSAPP: "WhatsApp", WHATSAPP_BUSINESS: "WhatsApp Business" };
export function phoneDetails(value: string | null | undefined) {
  const digits = onlyDigits(value);
  const domestic = digits.startsWith("55") && (digits.length === 12 || digits.length === 13) ? digits.slice(2) : digits;
  const brazilian = domestic.length === 10 || domestic.length === 11;
  const international = brazilian ? `55${domestic}` : digits;
  const kind = domestic.length === 10 && /^[2-5]/.test(domestic.slice(2)) ? "Fixo" : domestic.length === 11 && domestic[2] === "9" ? "Celular" : "Tipo não identificado";
  return { kind, whatsappUrl: brazilian ? `https://wa.me/${international}` : null, telephoneUrl: digits ? `tel:+${international}` : null };
}
