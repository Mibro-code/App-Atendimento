// Pure proposal policy, not wired to the sender/worker. Uses the existing
// calendar and keeps reminder scheduling in after-hours-reminder-service.
const calendar = require('./business-hours-service');

function assistantCalendar({ bot, triage, companyId, now = new Date(), holidays = [] }) {
  if (!companyId || bot?.companyId !== companyId || triage?.companyId !== companyId || triage?.type !== 'SYSTEM_TRIAGE') {
    return { configured: false, open: false, reason: 'COMPANY_OR_TRIAGE_MISMATCH' };
  }
  const schedules = Array.isArray(triage.schedules) ? triage.schedules : [];
  if (!schedules.length) return { configured: false, open: false, reason: 'TRIAGE_SCHEDULE_MISSING' };
  const timezone = triage.timezone || 'America/Sao_Paulo';
  const clock = calendar.zonedClock(now, timezone);
  const current = schedules.find(s => s.dayOfWeek === clock.dayOfWeek);
  const config = {
    timezone, businessDays: schedules.filter(s => s.enabled).map(s => s.dayOfWeek),
    businessStartTime: current?.startTime || '00:00', businessEndTime: current?.endTime || '00:00',
  };
  // Explicit shared calendar exceptions take precedence. A BotHoliday fills
  // only dates without an explicit company/global calendar row.
  const knownDates = new Set(holidays.filter(h => h.scopeKey === companyId || h.scopeKey === 'GLOBAL').map(h => h.date));
  const botHolidays = (triage.holidays || []).filter(h => h.enabled !== false && !knownDates.has(h.date)).map(h => ({ date: h.date, name: h.name, scopeKey: companyId, active: true, allDay: true }));
  return { configured: true, companyId, source: 'COMPANY_TRIAGE', sourceBotId: triage.id, ...calendar.evaluateBusinessCalendar(now, config, [...holidays, ...botHolidays], companyId) };
}

function planAssistantEntry({ bot, conversation, availability, globalAutomationEnabled, noticeAlreadySent = false }) {
  if (!bot?.companyId || !conversation?.companyId || bot.companyId !== conversation.companyId) return { action: 'BLOCK', reason: 'COMPANY_MISMATCH' };
  if (bot.archivedAt || bot.status !== 'ACTIVE' || bot.autoReplyEnabled !== true || !globalAutomationEnabled) return { action: 'BLOCK', reason: 'AUTOMATION_DISABLED' };
  if (conversation.channel !== 'META' || conversation.status === 'FINALIZADO' || conversation.assignedUserId || conversation.humanPaused || conversation.masterOnly) return { action: 'BLOCK', reason: 'HUMAN_OR_ACCESS_RULE' };
  if (bot.id === 'mibro-assistant-observer' && conversation.categoryCode === 'ATACADO') return { action: 'HUMAN_ONLY', reason: 'COMMERCIAL_WHOLESALE_EXCLUDED', sendMessage: false };
  if (!availability?.configured || availability.companyId !== conversation.companyId) return { action: 'BLOCK', reason: 'SCHEDULE_REQUIRES_REVIEW' };
  if (availability.open) return { action: 'START_ASSISTANT', queueForHuman: false };
  return {
    action: 'QUEUE_OUTSIDE_HOURS', sendExistingNotice: !noticeAlreadySent,
    collect: conversation.categoryCode === '1_ASSISTENCIA_TECNICA' ? 'SN_PURCHASE_INVOICE_ONCE' : 'KEEP_EXISTING_REQUEST',
    queueForHuman: true, preserveCategory: true, startLongMenu: false, promiseImmediateReply: false,
    reminderOwner: 'EXISTING_AFTER_HOURS_WORKER',
  };
}

function calendarMismatchWarnings(triage, reminderSettings) {
  if (!reminderSettings) return ['Regra do lembrete ainda não foi conferida.'];
  const active = (triage?.schedules || []).filter(s => s.enabled);
  const days = [...new Set(active.map(s => s.dayOfWeek))].sort().join(',');
  const reminderDays = [...new Set(reminderSettings.businessDays || [])].sort().join(',');
  const warnings = [];
  if (!active.length || days !== reminderDays || active.some(s => s.startTime !== reminderSettings.businessStartTime || s.endTime !== reminderSettings.businessEndTime) || (triage?.timezone || 'America/Sao_Paulo') !== reminderSettings.timezone) {
    warnings.push('Calendários da triagem e do lembrete divergem; alinhar antes de ativar.');
  }
  if (!reminderSettings.enabled) warnings.push('O lembrete cadastrado está desligado; preservar até aprovação de ativação.');
  return warnings;
}

module.exports = { assistantCalendar, calendarMismatchWarnings, planAssistantEntry };
