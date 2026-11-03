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

// ----------------------------------------------------------------------
// Expediente configurável (Atendimento fora do expediente). Funções puras,
// sem I/O: recebem a configuração (AfterHoursSettings) e os feriados já
// carregados. isBusinessHours acima continua fixo para SLA/triagem.

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const formatters = new Map();

function minutesOf(value) {
  const match = TIME_PATTERN.exec(String(value || ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function formatterFor(timezone) {
  if (!formatters.has(timezone)) {
    formatters.set(timezone, new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, hourCycle: "h23", weekday: "short",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }));
  }
  return formatters.get(timezone);
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Data/hora local no fuso informado (dayOfWeek: 0 = domingo).
function zonedClock(instant, timezone = businessTimeZone) {
  const parts = Object.fromEntries(formatterFor(timezone).formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
    dayOfWeek: WEEKDAY_INDEX[parts.weekday],
    date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`,
  };
}

// Instante UTC de "AAAA-MM-DD HH:MM" no fuso (duas iterações cobrem o
// horário de verão, se o fuso voltar a ter).
function zonedInstant(date, time, timezone = businessTimeZone) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset = (ms) => {
    const p = zonedClock(ms, timezone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first));
}

function addDaysToDate(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher).
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Feriados nacionais (Lei 662/1949, 6.802/1980 e 14.759/2023) — fallback
// local, sem integração externa. Carnaval e Corpus Christi são pontos
// facultativos: cadastre-os como data da empresa quando a equipe folgar.
function nationalHolidays(year) {
  const fixed = [
    ["01-01", "Confraternização Universal"], ["04-21", "Tiradentes"], ["05-01", "Dia do Trabalho"],
    ["09-07", "Independência do Brasil"], ["10-12", "Nossa Senhora Aparecida"], ["11-02", "Finados"],
    ["11-15", "Proclamação da República"], ["11-20", "Dia Nacional de Zumbi e da Consciência Negra"], ["12-25", "Natal"],
  ].map(([monthDay, name]) => ({ date: `${year}-${monthDay}`, name }));
  fixed.push({ date: addDaysToDate(easterSunday(year), -2), name: "Sexta-feira Santa" });
  return fixed.sort((left, right) => left.date.localeCompare(right.date))
    .map((holiday) => ({ ...holiday, scope: "NACIONAL", scopeKey: "BUILTIN", allDay: true, active: true, builtin: true }));
}

// Linha da empresa > linha global > nacional calculado. Linha inativa
// desliga a data naquele escopo (inclusive o nacional calculado).
function holidayFor(date, holidays = [], companyId = null) {
  const own = companyId ? holidays.find((item) => item.date === date && item.scopeKey === companyId) : null;
  const chosen = own || holidays.find((item) => item.date === date && item.scopeKey === "GLOBAL")
    || nationalHolidays(Number(date.slice(0, 4))).find((item) => item.date === date) || null;
  return chosen && chosen.active !== false ? chosen : null;
}

// { open, dayKind, holiday, date, time } do instante, pela configuração.
// Fim do expediente é exclusivo: 17:00 já é fora; 08:00 já é dentro.
function evaluateBusinessCalendar(instant, config, holidays = [], companyId = null) {
  const timezone = config.timezone || businessTimeZone;
  const clock = zonedClock(instant, timezone);
  const holiday = holidayFor(clock.date, holidays, companyId);
  const now = minutesOf(clock.time);
  let open;
  if (holiday) {
    const from = minutesOf(holiday.openTime), to = minutesOf(holiday.closeTime);
    open = holiday.allDay === false && from !== null && to !== null && now >= from && now < to;
  } else {
    const days = Array.isArray(config.businessDays) ? config.businessDays : [1, 2, 3, 4, 5];
    open = days.includes(clock.dayOfWeek)
      && now >= minutesOf(config.businessStartTime || "08:00") && now < minutesOf(config.businessEndTime || "17:00");
  }
  const dayKind = holiday ? "HOLIDAY" : clock.dayOfWeek === 6 ? "SATURDAY" : clock.dayOfWeek === 0 ? "SUNDAY" : "WEEKDAY";
  return { open, dayKind, holiday, date: clock.date, time: clock.time, dayOfWeek: clock.dayOfWeek, timezone };
}

// Faixa de silêncio que pode atravessar a meia-noite (22:00–08:00).
function isQuietTime(instant, config) {
  if (!config.quietHoursEnabled) return false;
  const start = minutesOf(config.quietStartTime), end = minutesOf(config.quietEndTime);
  if (start === null || end === null || start === end) return false;
  const now = minutesOf(zonedClock(instant, config.timezone || businessTimeZone).time);
  return start < end ? now >= start && now < end : now >= start || now < end;
}

// Próximo fim do silêncio a partir de um instante dentro dele.
function quietHoursEnd(instant, config) {
  const timezone = config.timezone || businessTimeZone;
  const clock = zonedClock(instant, timezone);
  const sameDay = zonedInstant(clock.date, config.quietEndTime, timezone);
  return sameDay > new Date(instant) ? sameDay : zonedInstant(addDaysToDate(clock.date, 1), config.quietEndTime, timezone);
}

module.exports = {
  addDaysToDate, businessHoursText, businessTimeZone, evaluateBusinessCalendar, holidayFor, isBusinessHours,
  isQuietTime, minutesOf, nationalHolidays, quietHoursEnd, zonedClock, zonedInstant,
};
