// Horário comercial — extraído de triage-bot-service.js (isBusinessHours)
// para ser reutilizável por qualquer serviço, ex. conversation-sla-service.js
// (item 9 de Configurações → Conversas: "reutilizar, não duplicar"). Ainda é
// um horário fixo (não configurável); só deixou de estar preso ao bot de
// triagem.
const businessTimeZone = "America/Sao_Paulo";
const businessHoursText = "segunda a sexta-feira, das 8h às 17h (horário de Brasília)";

function businessParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: businessTimeZone, weekday: "short", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function isBusinessHours(date = new Date()) {
  const { weekday, hour } = businessParts(date);
  return !["Sat", "Sun"].includes(weekday) && Number(hour) >= 8 && Number(hour) < 17;
}

module.exports = { businessHoursText, businessTimeZone, isBusinessHours };
