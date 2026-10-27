// Calendário da operação (America/Sao_Paulo) independente do fuso do
// servidor. O container de produção roda em UTC: sem isto, "Hoje" começaria
// às 21h de Brasília e os buckets diários dos relatórios ficariam deslocados.
// Timestamps continuam sendo gravados em UTC no banco; só a leitura de
// "que dia/hora é isto na operação" passa por aqui.
const TIME_ZONE = "America/Sao_Paulo";

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
});
const WEEKDAYS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

// { year, month (1-12), day, hour, minute, weekday (0 = segunda) } no fuso da operação.
function zonedParts(date) {
  const parts = Object.fromEntries(partsFormatter.formatToParts(new Date(date)).map(({ type, value }) => [type, value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second), weekday: WEEKDAYS[parts.weekday],
  };
}

// Diferença (ms) entre o relógio da operação e UTC naquele instante.
function offsetMs(date) {
  const p = zonedParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(new Date(date).getTime() / 1000) * 1000;
}

// Instante UTC da meia-noite de year/month/day no fuso da operação. Aceita
// dia/mês fora do intervalo (Date.UTC normaliza: dia 0 = último do mês anterior).
function zonedMidnight(year, month, day) {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetMs(guess);
  return new Date(guess - offsetMs(first));
}

function startOfZonedDay(date) {
  const p = zonedParts(date);
  return zonedMidnight(p.year, p.month, p.day);
}

function addZonedDays(date, days) {
  const p = zonedParts(date);
  return zonedMidnight(p.year, p.month, p.day + days);
}

function startOfZonedMonth(date, monthOffset = 0) {
  const p = zonedParts(date);
  return zonedMidnight(p.year, p.month + monthOffset, 1);
}

// "AAAA-MM-DD" (input type=date) -> meia-noite daquele dia na operação.
function parseZonedDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  return zonedMidnight(Number(match[1]), Number(match[2]), Number(match[3]));
}

// "AAAA-MM-DD" + "HH:MM" no relógio da operação -> instante UTC (corrige a
// hora em dia de mudança de fuso). null se algo for inválido.
function localDateTime(dateKey, time = "09:00") {
  const day = parseZonedDate(dateKey);
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || "").trim());
  if (!day || !match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  const guess = new Date(day.getTime() + minutes * 60000);
  const check = zonedParts(guess);
  return new Date(guess.getTime() - ((check.hour * 60 + check.minute) - minutes) * 60000);
}

// Chave "AAAA-MM-DD" do dia na operação.
function zonedDateKey(date) {
  const p = zonedParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

module.exports = { TIME_ZONE, addZonedDays, localDateTime, parseZonedDate, startOfZonedDay, startOfZonedMonth, zonedDateKey, zonedMidnight, zonedParts };
