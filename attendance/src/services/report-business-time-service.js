// Relatórios: interseção exata com o calendário configurado, sem alterar SLA/bots.
const prisma = require('../database/prisma');
const DAY = 86400000;
const defaultCalendar = { timezone: 'America/Sao_Paulo', schedules: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, enabled: dayOfWeek > 0 && dayOfWeek < 6, startTime: '08:00', endTime: '17:00' })), holidays: [] };

async function loadCalendars(companyIds, client = prisma) {
  if (!companyIds.length) return [];
  return client.bot.findMany({
    where: { companyId: { in: companyIds }, archivedAt: null, status: { not: 'ARCHIVED_LEGACY' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, companyId: true, type: true, timezone: true, featureFlags: true, schedules: true, holidays: true },
  });
}

function calendarFor(conversation, bots) {
  const companyBots = bots.filter(b => b.companyId === conversation.companyId);
  const primary = companyBots.find(b => b.type === 'SYSTEM_TRIAGE');
  const specific = companyBots.find(b => b.schedules.length && Array.isArray(b.featureFlags?.channelAccountIds) && b.featureFlags.channelAccountIds.includes(conversation.channelAccountId));
  const selected = specific || primary;
  return selected ? { ...selected, schedules: selected.schedules.length ? selected.schedules : defaultCalendar.schedules } : defaultCalendar;
}

// Pré-calcula dias uma vez; cada duração usa duas buscas binárias, não itera
// minuto a minuto nem por dia para cada conversa. Intl respeita o fuso e DST.
function createBusinessClock(start, end, calendar = defaultCalendar) {
  const timezone = calendar.timezone || defaultCalendar.timezone;
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const parts = timestamp => Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(p => [p.type, p.value]));
  const localOrdinal = timestamp => { const p = parts(timestamp); return Date.UTC(+p.year, +p.month - 1, +p.day); };
  const toUtc = (ordinal, time) => {
    const [h, m] = time.split(':').map(Number);
    const target = ordinal + h * 3600000 + m * 60000;
    let guess = target;
    for (let i = 0; i < 4; i++) {
      const p = parts(guess);
      const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      const next = guess + target - wall;
      if (next === guess) break;
      guess = next;
    }
    return guess;
  };
  const from = Number(start), to = Number(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return () => 0;
  const holidays = new Set((calendar.holidays || []).filter(h => h.enabled !== false).map(h => h.date));
  const intervals = [];
  let total = 0;
  for (let day = localOrdinal(from); day <= localOrdinal(to); day += DAY) {
    const date = new Date(day);
    if (holidays.has(date.toISOString().slice(0,10))) continue;
    const schedule = (calendar.schedules || []).find(s => s.dayOfWeek === date.getUTCDay());
    if (!schedule?.enabled || schedule.endTime <= schedule.startTime) continue;
    const a = toUtc(day, schedule.startTime), b = toUtc(day, schedule.endTime);
    intervals.push({ start: a, end: b, before: total });
    total += b - a;
  }
  const accumulated = timestamp => {
    let lo = 0, hi = intervals.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (intervals[mid].start <= timestamp) lo = mid + 1; else hi = mid; }
    if (!lo) return 0;
    const item = intervals[lo - 1];
    return item.before + Math.max(0, Math.min(timestamp, item.end) - item.start);
  };
  return (a, b) => Math.max(0, accumulated(Number(b)) - accumulated(Number(a))) / 1000;
}

module.exports = { defaultCalendar, loadCalendars, calendarFor, createBusinessClock };
