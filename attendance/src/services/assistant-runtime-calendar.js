const { assistantCalendar } = require('./assistant-business-policy');
const calendar = require('./business-hours-service');

const REVISION = 'assistant-20261027';
const usesCompanyCalendar = bot => bot?.featureFlags?.assistantCalendarRevision === REVISION;

async function resolveCalendar(db, bot, now) {
  if (!usesCompanyCalendar(bot)) return null;
  const triage = bot.type === 'SYSTEM_TRIAGE' ? bot : await db.bot.findFirst({
    where: { id: bot.featureFlags.scheduleSourceBotId, companyId: bot.companyId, type: 'SYSTEM_TRIAGE', archivedAt: null },
    include: { schedules: true, holidays: true },
  });
  const date = calendar.zonedClock(now, triage?.timezone || 'America/Sao_Paulo').date;
  const holidays = await db.businessHoliday.findMany({ where: {
    scopeKey: { in: ['GLOBAL', bot.companyId] }, date: { gte: date, lte: calendar.addDaysToDate(date, 35) },
  } });
  return { triage, holidays, availability: { ...assistantCalendar({ bot, triage, companyId: bot.companyId, now, holidays }), businessHours: triage ? require('./bot-schedule-utils').describeSchedule(triage) : '' } };
}

// The next opening identifies the whole closed interval, across midnight,
// weekends and holidays. A missing opening fails closed rather than resending daily.
function closedPeriod({ bot, triage, holidays, availability }, now) {
  if (!availability?.configured || availability.open) return null;
  const timezone = triage.timezone || 'America/Sao_Paulo';
  for (let offset = 0; offset <= 35; offset++) {
    const date = calendar.addDaysToDate(availability.date, offset);
    const midday = calendar.zonedInstant(date, '12:00', timezone);
    const day = calendar.zonedClock(midday, timezone).dayOfWeek;
    const schedule = triage.schedules.find(row => row.dayOfWeek === day);
    const effective = assistantCalendar({ bot, triage, companyId: bot.companyId, now: midday, holidays });
    const holiday = effective.holiday;
    if (holiday ? holiday.allDay !== false : !schedule?.enabled) continue;
    const opening = calendar.zonedInstant(date, holiday ? holiday.openTime : schedule.startTime, timezone);
    if (!Number.isFinite(opening?.getTime()) || opening <= now) continue;
    if (assistantCalendar({ bot, triage, companyId: bot.companyId, now: opening, holidays }).open) return opening.toISOString();
  }
  return null;
}

module.exports = { REVISION, usesCompanyCalendar, resolveCalendar, closedPeriod };
