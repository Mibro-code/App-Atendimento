// Lembrete automático fora do expediente.
//
// Fluxo: mensagem real do cliente (WhatsApp) recebida fora do expediente
// → agenda um lembrete para `delayMinutes` depois dela (persistido em
// AfterHoursReminder, um por ciclo de espera). Nova mensagem no mesmo ciclo
// só move a referência e o prazo. O worker (backend, sem navegador) reconfere
// TUDO no banco antes de enviar e envia no máximo uma vez:
//   PENDING → PROCESSING (claim atômico) → SENT | CANCELLED | SKIPPED |
//   FAILED (falha confirmada, nada saiu) | UNKNOWN (pode ter saído: nunca
//   reenviar sozinho).
//
// Regra crítica: o lembrete NÃO renova a janela de 24 h da Meta. A janela é
// sempre calculada pela última mensagem recebida do cliente naquele número
// (meta-template-service#getCustomerServiceWindow); fora dela (ou dentro da
// margem de segurança) nada é enviado, e nenhum template é usado no lugar.
// O lembrete não muda status, categoria, responsável, atendente fixo,
// prioridade nem lastMessageAt da conversa.
const crypto = require("node:crypto");
const prisma = require("../database/prisma");
const calendar = require("./business-hours-service");
const settingsService = require("./after-hours-settings-service");
const { getCustomerServiceWindow } = require("./meta-template-service");
const whatsappAccounts = require("./whatsapp-account-service");

const KIND = "AFTER_HOURS";
const SYSTEM_TAG = "after_hours_reminder";
const ORIGIN_LABEL = "Automação — Fora do expediente";
// "Pendente" = aguardando a equipe. BOT só quando o fluxo não está no meio
// de uma conversa com o cliente (ver botFlowBlocks).
const PENDING_STATUSES = ["NOVO", "AGUARDANDO_EQUIPE", "HANDOFF_BOT", "BOT"];
const HUMAN_STATUSES = ["EM_ATENDIMENTO", "AGUARDANDO_CLIENTE"];
// Marcos que encerram um ciclo de espera (além de resposta humana).
const CYCLE_BOUNDARY_ACTIONS = ["REOPENED_BY_CUSTOMER_MESSAGE"];
const FINAL_STATUSES = ["SENT", "UNKNOWN", "PROCESSING"];
const SEND_TIMEOUT_MS = 30 * 1000;
const STALE_CLAIM_MS = 5 * 60 * 1000;
const MINUTE = 60 * 1000;

const isWamid = (externalId) => /^(?:[^:]+:)?wamid\./.test(String(externalId || ""));

function isCustomerMessage(message) {
  return Boolean(message && message.direction === "RECEBIDA" && (message.channel || "META") === "META"
    && message.type !== "reaction" && isWamid(message.externalId));
}

function isReminderMessage(message) {
  return message?.rawPayload?.system === SYSTEM_TAG;
}

const conversationInclude = { contact: true, company: { select: { id: true, active: true } } };

async function loadConversation(conversationId, client = prisma) {
  return client.conversation.findUnique({ where: { id: conversationId }, include: conversationInclude });
}

async function calendarAt(instant, settings, companyId) {
  const { date } = calendar.zonedClock(instant, settings.timezone);
  const holidays = await settingsService.holidaysForDates(companyId, [date]);
  return calendar.evaluateBusinessCalendar(instant, settings, holidays, companyId);
}

const DAY_TOGGLES = { SATURDAY: "remindOnSaturday", SUNDAY: "remindOnSunday", HOLIDAY: "remindOnHolidays" };

function eligibleReminderDay(instant, settings, day) {
  if (day.dayKind === "HOLIDAY") return settings.remindOnHolidays;
  const local = calendar.zonedClock(instant, settings.timezone);
  if (local.dayOfWeek === 6) return settings.remindOnSaturday;
  if (local.dayOfWeek === 0) return settings.remindOnSunday;
  return local.dayOfWeek === 5 && calendar.minutesOf(local.time) >= calendar.minutesOf(settings.businessEndTime)
    && settings.remindOnSaturday;
}

// Última mensagem real do cliente na conversa (qualquer número).
async function latestCustomerMessage(conversationId, client = prisma) {
  return client.message.findFirst({
    where: { conversationId, direction: "RECEBIDA", type: { not: "reaction" }, OR: [{ externalId: { startsWith: "wamid." } }, { externalId: { contains: ":wamid." } }] },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
  });
}

// Ciclo de espera = desde o último marco que o encerra: resposta de uma
// pessoa da equipe ou reabertura da conversa. Chave estável (id do marco),
// então mensagens novas do cliente no mesmo ciclo caem na mesma linha.
async function cycleAnchor(conversationId, client = prisma) {
  const [human, boundary] = await Promise.all([
    client.message.findFirst({
      where: { conversationId, direction: "ENVIADA", sentByUserId: { not: null } },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }], select: { id: true, occurredAt: true },
    }),
    client.conversationActivity.findFirst({
      where: { conversationId, action: { in: CYCLE_BOUNDARY_ACTIONS } },
      orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true },
    }),
  ]);
  if (boundary && (!human || boundary.createdAt > human.occurredAt)) return `act:${boundary.id}`;
  if (human) return `msg:${human.id}`;
  return "start";
}

// Fluxo do Bot no meio de uma conversa (menu aguardando resposta, timer,
// executando) não recebe lembrete; fluxo parado só por estar fora do
// horário (availabilityWaiting) ou sem execução ativa, sim.
async function botFlowBlocks(conversationId, client = prisma) {
  const active = await client.botFlowExecution.findFirst({
    where: { conversationId, status: { in: ["RUNNING", "WAITING_CUSTOMER", "WAITING_TIMER"] } },
    orderBy: { startedAt: "desc" }, select: { status: true, context: true },
  });
  if (!active) return false;
  return !(active.status === "WAITING_CUSTOMER" && active.context?._engine?.availabilityWaiting === true);
}

// null = elegível; senão { status, reason } para registrar.
async function ineligibility(conversation, settings, referenceAt, client = prisma) {
  const cancel = (reason) => ({ status: "CANCELLED", reason });
  if (!conversation) return cancel("CONVERSATION_NOT_FOUND");
  if (conversation.channel !== "META") return cancel("NOT_WHATSAPP");
  if (conversation.company && conversation.company.active === false) return cancel("COMPANY_INACTIVE");
  if (conversation.status === "FINALIZADO") return cancel("CONVERSATION_FINALIZED");
  if (settings.onlyPending) {
    if (!PENDING_STATUSES.includes(conversation.status)) return cancel("NOT_PENDING");
    if (conversation.status === "BOT" && await botFlowBlocks(conversation.id, client)) return cancel("BOT_FLOW_IN_PROGRESS");
  }
  if (settings.onlyWithoutHuman) {
    if (HUMAN_STATUSES.includes(conversation.status)) return cancel("HUMAN_ATTENDING");
    // Responsável humano de fato (assumiu, recebeu transferência, respondeu)
    // tem período de responsabilidade aberto. Atendente fixo atribuído pelo
    // roteamento automático não tem — continua elegível até alguém agir.
    if (conversation.assignedUserId) {
      const open = await client.conversationAssignmentPeriod.findFirst({
        where: { conversationId: conversation.id, userId: conversation.assignedUserId, endedAt: null }, select: { id: true },
      });
      if (open) return cancel("HUMAN_ASSIGNED");
    }
    const humanReply = await client.message.findFirst({
      where: { conversationId: conversation.id, direction: "ENVIADA", sentByUserId: { not: null }, occurredAt: { gte: referenceAt } },
      select: { id: true },
    });
    if (humanReply) return cancel("HUMAN_REPLIED");
  }
  const phone = conversation.contact?.phone;
  if (phone && await require("./campaign-optout-service").isOptedOut(phone, conversation.companyId, client)) return cancel("CONTACT_OPTED_OUT");
  return null;
}

// Prazo do lembrete e limite da janela Meta para a mensagem de referência.
async function planFor(conversation, message, settings) {
  const window = await getCustomerServiceWindow(conversation.id, message.occurredAt, message.channelAccountId || null);
  const windowExpiresAt = window.expiresAt ? new Date(window.expiresAt) : new Date(message.occurredAt.getTime() + 24 * 60 * MINUTE);
  const limit = new Date(windowExpiresAt.getTime() - settings.metaSafetyMarginMinutes * MINUTE);
  let dueAt = new Date(message.occurredAt.getTime() + settings.delayMinutes * MINUTE);
  let deferred = false;
  if (calendar.isQuietTime(dueAt, settings)) { dueAt = calendar.quietHoursEnd(dueAt, settings); deferred = true; }
  const skip = dueAt > limit ? (deferred ? "QUIET_HOURS_UNTIL_WINDOW_END" : "WINDOW_TOO_SHORT") : null;
  return { dueAt, windowExpiresAt, skip, deferred };
}

async function cancelPendingForConversation(conversationId, reason, client = prisma) {
  if (!conversationId) return 0;
  const result = await client.afterHoursReminder.updateMany({
    where: { conversationId, OR: [{ status: "PENDING" }, { status: "PROCESSING", sendStartedAt: null }] },
    data: { status: "CANCELLED", reason, claimToken: null },
  });
  return result.count;
}

// Hooks dos fluxos existentes: nunca derrubam a operação principal.
function cancelSafely(conversationId, reason) {
  return cancelPendingForConversation(conversationId, reason).catch((error) => {
    console.error("[AFTER_HOURS] falha ao cancelar lembrete pendente (ignorada):", error.message);
    return 0;
  });
}

// Chamado pelo webhook depois de salvar a mensagem (e depois do Bot/atendente
// fixo, que podem mudar o estado). Idempotente: reentrega do mesmo evento ou
// mensagem fora de ordem nunca cria um segundo lembrete.
async function scheduleForInboundMessage(message, { now = new Date() } = {}) {
  if (!isCustomerMessage(message)) return { scheduled: false, reason: "NOT_CUSTOMER_MESSAGE" };
  const conversation = await loadConversation(message.conversationId);
  if (!conversation || conversation.channel !== "META") return { scheduled: false, reason: "NOT_WHATSAPP" };
  const settings = await settingsService.getEffectiveSettings(conversation.companyId);
  if (!settings.enabled) return { scheduled: false, reason: "DISABLED" };
  const occurredAt = new Date(message.occurredAt);
  const day = await calendarAt(occurredAt, settings, conversation.companyId);
  if (day.open) {
    await cancelPendingForConversation(conversation.id, "CUSTOMER_WROTE_DURING_BUSINESS_HOURS");
    return { scheduled: false, reason: "BUSINESS_HOURS" };
  }
  if (DAY_TOGGLES[day.dayKind] && !settings[DAY_TOGGLES[day.dayKind]]) return { scheduled: false, reason: `DAY_DISABLED_${day.dayKind}` };
  if (!eligibleReminderDay(occurredAt, settings, day)) {
    await cancelPendingForConversation(conversation.id, "OUTSIDE_REMINDER_DAYS");
    return { scheduled: false, reason: "OUTSIDE_REMINDER_DAYS" };
  }
  const blocked = await ineligibility(conversation, settings, occurredAt);
  if (blocked) return { scheduled: false, reason: blocked.reason };

  const plan = await planFor(conversation, { ...message, occurredAt }, settings);
  const cycleKey = await cycleAnchor(conversation.id);
  const data = {
    companyId: conversation.companyId, channelAccountId: message.channelAccountId || null,
    referenceMessageId: message.id, referenceAt: occurredAt, windowExpiresAt: plan.windowExpiresAt, dueAt: plan.dueAt,
    status: plan.skip ? "SKIPPED" : "PENDING", reason: plan.skip || (plan.deferred ? "QUIET_HOURS_DEFERRED" : null),
    reasonDetail: null, claimToken: null, claimedAt: null, sendStartedAt: null,
  };
  const key = { conversationId_kind_cycleKey: { conversationId: conversation.id, kind: KIND, cycleKey } };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await prisma.afterHoursReminder.findUnique({ where: key });
    if (!existing) {
      try {
        const created = await prisma.afterHoursReminder.create({ data: { ...data, conversationId: conversation.id, kind: KIND, cycleKey } });
        return { scheduled: !plan.skip, reason: data.reason, reminder: created };
      } catch (error) {
        if (error.code === "P2002") continue; // outra mensagem criou ao mesmo tempo
        throw error;
      }
    }
    // Um lembrete por ciclo: enviado, em envio ou com resultado incerto
    // encerram o ciclo para novos lembretes.
    if (FINAL_STATUSES.includes(existing.status)) return { scheduled: false, reason: `ALREADY_${existing.status}`, reminder: existing };
    // Mensagem antiga entregue fora de ordem nunca recua a referência.
    if (existing.referenceAt > occurredAt || (existing.referenceMessageId === message.id && existing.status === "PENDING")) {
      return { scheduled: false, reason: "NEWER_REFERENCE_EXISTS", reminder: existing };
    }
    // Troca otimista: só aplica se ninguém mudou a linha desde a leitura.
    const updated = await prisma.afterHoursReminder.updateMany({
      where: { id: existing.id, status: existing.status, referenceAt: existing.referenceAt },
      data: { ...data, rescheduleCount: { increment: 1 } },
    });
    if (updated.count) return { scheduled: !plan.skip, reason: data.reason, reminder: await prisma.afterHoursReminder.findUnique({ where: { id: existing.id } }) };
  }
  return { scheduled: false, reason: "CONCURRENT_UPDATE" };
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("Tempo esgotado aguardando a Meta."), { code: "AFTER_HOURS_SEND_TIMEOUT" })), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Falha confirmada (nada saiu) vs. resultado desconhecido (pode ter saído).
function classifySendError(error) {
  const status = error?.metaStatus ?? error?.response?.status ?? null;
  const detail = String(error?.message || "").slice(0, 500);
  if (["AFTER_HOURS_SEND_TIMEOUT", "ECONNABORTED", "ETIMEDOUT"].includes(error?.code)) return { status: "UNKNOWN", reason: "META_TIMEOUT", detail };
  if (status >= 400 && status < 500) return { status: "FAILED", reason: status === 429 ? "META_RATE_LIMITED" : "META_REJECTED", detail };
  // Rejeitado antes de qualquer chamada (número sem credencial etc.).
  if (error?.notSent === true || (!status && error?.statusCode === 503)) return { status: "FAILED", reason: "SENDER_NOT_CONFIGURED", detail };
  return { status: "UNKNOWN", reason: "META_RESULT_UNKNOWN", detail };
}

async function senderAccount(reminder, conversation) {
  const account = reminder.channelAccountId
    ? await prisma.channelAccount.findUnique({ where: { id: reminder.channelAccountId } })
    : await whatsappAccounts.getLegacyAccount();
  if (!account || account.companyId !== conversation.companyId) return null;
  if (!account.enabled || account.status !== "CONNECTED") return null;
  return account;
}

// Recuperação após reinício: claim sem início de envio volta à fila; envio
// iniciado sem resultado vira UNKNOWN (nunca reenviado automaticamente).
async function recoverStaleClaims(now = new Date()) {
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS);
  const [requeued, unknown] = await Promise.all([
    prisma.afterHoursReminder.updateMany({
      where: { status: "PROCESSING", sendStartedAt: null, claimedAt: { lt: staleBefore } },
      data: { status: "PENDING", claimToken: null, reason: "RECOVERED_AFTER_RESTART" },
    }),
    prisma.afterHoursReminder.updateMany({
      where: { status: "PROCESSING", sendStartedAt: { not: null }, claimedAt: { lt: staleBefore } },
      data: { status: "UNKNOWN", claimToken: null, reason: "INTERRUPTED_DURING_SEND" },
    }),
  ]);
  return { requeued: requeued.count, unknown: unknown.count };
}

async function recordActivity(conversationId, action, details) {
  await prisma.conversationActivity.create({ data: { conversationId, action, details } }).catch(() => {});
}

async function processReminder(id, { channel, now: fixedNow, clock, sendTimeoutMs = SEND_TIMEOUT_MS } = {}) {
  const readNow = clock || (fixedNow ? () => new Date(fixedNow) : () => new Date());
  let now = readNow();
  const token = crypto.randomUUID();
  const claimed = await prisma.afterHoursReminder.updateMany({
    where: { id, status: "PENDING", dueAt: { lte: now } },
    data: { status: "PROCESSING", claimToken: token, claimedAt: now, attempts: { increment: 1 } },
  });
  if (!claimed.count) return "NOT_CLAIMED";
  const reminder = await prisma.afterHoursReminder.findUnique({ where: { id } });
  const finish = async (status, reason, extra = {}) => {
    await prisma.afterHoursReminder.updateMany({
      where: { id, claimToken: token, status: "PROCESSING" }, data: { status, reason, claimToken: null, ...extra },
    });
    return status;
  };
  let sendStarted = false;
  try {
    const conversation = await loadConversation(reminder.conversationId);
    if (!conversation) return finish("CANCELLED", "CONVERSATION_NOT_FOUND");
    if (conversation.companyId !== reminder.companyId) return finish("CANCELLED", "COMPANY_CHANGED");
    const settings = await settingsService.getEffectiveSettings(conversation.companyId);
    if (!settings.enabled) return finish("CANCELLED", "AUTOMATION_DISABLED");

    // Cliente escreveu de novo: este agendamento ficou obsoleto. Devolve à
    // fila e recalcula pela mensagem nova (que pode até cancelar o lembrete,
    // ex.: escreveu dentro do expediente).
    const latest = await latestCustomerMessage(conversation.id);
    if (latest && latest.id !== reminder.referenceMessageId && latest.occurredAt > reminder.referenceAt) {
      await finish("PENDING", "RESCHEDULED_NEWER_MESSAGE");
      const result = await scheduleForInboundMessage(latest, { now });
      await prisma.afterHoursReminder.updateMany({
        where: { id, status: "PENDING", referenceMessageId: reminder.referenceMessageId },
        data: { status: "CANCELLED", reason: `OBSOLETE_${result.reason || "NEWER_MESSAGE"}` },
      });
      return "RESCHEDULED";
    }

    const blocked = await ineligibility(conversation, settings, reminder.referenceAt);
    if (blocked) return finish(blocked.status, blocked.reason);
    const referenceDay = await calendarAt(reminder.referenceAt, settings, conversation.companyId);
    if (!eligibleReminderDay(reminder.referenceAt, settings, referenceDay)) return finish("CANCELLED", "OUTSIDE_REMINDER_DAYS");
    const account = await senderAccount(reminder, conversation);
    if (!account) return finish("SKIPPED", "NUMBER_UNAVAILABLE");
    now = readNow();
    if ((await calendarAt(now, settings, conversation.companyId)).open) return finish("SKIPPED", "TEAM_BACK_IN_BUSINESS_HOURS");

    const window = await getCustomerServiceWindow(conversation.id, now, reminder.channelAccountId || null);
    if (!window.open || !window.expiresAt) return finish("SKIPPED", "WINDOW_EXPIRED");
    const limit = new Date(new Date(window.expiresAt).getTime() - settings.metaSafetyMarginMinutes * MINUTE);
    if (now >= limit) return finish("SKIPPED", "WINDOW_SAFETY_MARGIN", { windowExpiresAt: new Date(window.expiresAt) });

    if (calendar.isQuietTime(now, settings)) {
      const next = calendar.quietHoursEnd(now, settings);
      if (next < limit && !(await calendarAt(next, settings, conversation.companyId)).open) {
        return finish("PENDING", "QUIET_HOURS_DEFERRED", { dueAt: next });
      }
      return finish("SKIPPED", "QUIET_HOURS_UNTIL_WINDOW_END");
    }

    if (!conversation.contact?.phone) return finish("CANCELLED", "CONTACT_WITHOUT_PHONE");

    const text = String(settings.reminderMessage || "").trim();
    if (!text) return finish("CANCELLED", "EMPTY_MESSAGE");
    const marked = await prisma.afterHoursReminder.updateMany({
      where: { id, claimToken: token, status: "PROCESSING" }, data: { sendStartedAt: new Date() },
    });
    if (!marked.count) return "LOST_CLAIM";
    // A marcação no banco pode atravessar o início do silêncio ou o limite
    // da janela. Nada saiu ainda: reconfere com relógio atual antes da Meta.
    const sendNow = readNow();
    if (sendNow >= limit) return finish("SKIPPED", "WINDOW_SAFETY_MARGIN", { sendStartedAt: null });
    if (calendar.isQuietTime(sendNow, settings)) {
      const next = calendar.quietHoursEnd(sendNow, settings);
      if (next < limit && !(await calendarAt(next, settings, conversation.companyId)).open) {
        return finish("PENDING", "QUIET_HOURS_DEFERRED", { dueAt: next, sendStartedAt: null });
      }
      return finish("SKIPPED", "QUIET_HOURS_UNTIL_WINDOW_END", { sendStartedAt: null });
    }
    if (Math.floor(sendNow.getTime() / MINUTE) !== Math.floor(now.getTime() / MINUTE)
      && (await calendarAt(sendNow, settings, conversation.companyId)).open) {
      return finish("SKIPPED", "TEAM_BACK_IN_BUSINESS_HOURS", { sendStartedAt: null });
    }
    sendStarted = true;

    let result;
    try {
      result = await withTimeout(Promise.resolve().then(() => whatsappAccounts.senderFor(channel, account).sendText(conversation.contact.phone, text)), sendTimeoutMs);
    } catch (error) {
      const outcome = classifySendError(error);
      console.error(`[AFTER_HOURS] envio do lembrete ${id} terminou como ${outcome.status} (${outcome.reason})`);
      await finish(outcome.status, outcome.reason, { reasonDetail: outcome.detail });
      await recordActivity(conversation.id, outcome.status === "FAILED" ? "AFTER_HOURS_REMINDER_FAILED" : "AFTER_HOURS_REMINDER_UNKNOWN", {
        reminderId: id, reason: outcome.reason, origin: ORIGIN_LABEL,
      });
      return outcome.status;
    }

    const metaMessageId = result?.externalId || null;
    const occurredAt = new Date();
    try {
      await prisma.$transaction(async (tx) => {
        const message = await tx.message.create({ data: {
          conversationId: conversation.id, channel: "META", channelAccountId: reminder.channelAccountId || null,
          externalId: metaMessageId, direction: "ENVIADA", status: "ENVIADA", type: "text", text, occurredAt,
          rawPayload: { system: SYSTEM_TAG, automation: "AFTER_HOURS_REMINDER", origin: ORIGIN_LABEL, reminderId: id, cycleKey: reminder.cycleKey, message: result?.data || null },
        } });
        const done = await tx.afterHoursReminder.updateMany({
          where: { id, claimToken: token, status: "PROCESSING" },
          data: { status: "SENT", reason: null, claimToken: null, sentAt: occurredAt, metaMessageId, messageId: message.id },
        });
        if (!done.count) throw new Error("Lembrete perdeu o claim depois do envio.");
        await tx.conversationActivity.create({ data: {
          conversationId: conversation.id, action: "AFTER_HOURS_REMINDER_SENT",
          details: { reminderId: id, metaMessageId, channelAccountId: reminder.channelAccountId || null, referenceAt: reminder.referenceAt, windowExpiresAt: window.expiresAt, origin: ORIGIN_LABEL },
        } });
      });
    } catch (error) {
      // A Meta aceitou, mas o registro local falhou: nunca reenviar.
      console.error(`[AFTER_HOURS] lembrete ${id} aceito pela Meta (${metaMessageId}) mas não registrado:`, error.message);
      await finish("UNKNOWN", "SENT_NOT_RECORDED", { metaMessageId, reasonDetail: String(error.message).slice(0, 500) });
      return "UNKNOWN";
    }
    return "SENT";
  } catch (error) {
    console.error(`[AFTER_HOURS] falha ao processar lembrete ${id}:`, error.message);
    // Antes do envio nada saiu: falha confirmada. Depois, resultado incerto.
    return finish(sendStarted ? "UNKNOWN" : "FAILED", sendStarted ? "META_RESULT_UNKNOWN" : "INTERNAL_ERROR", { reasonDetail: String(error.message).slice(0, 500) });
  }
}

async function processDueReminders({ channel, now: fixedNow, clock, limit = 20, sendTimeoutMs } = {}) {
  const readNow = clock || (fixedNow ? () => new Date(fixedNow) : () => new Date());
  const now = readNow();
  await recoverStaleClaims(now);
  const due = await prisma.afterHoursReminder.findMany({
    where: { status: "PENDING", dueAt: { lte: now } }, orderBy: { dueAt: "asc" }, take: limit, select: { id: true },
  });
  const results = {};
  for (const { id } of due) {
    const outcome = await processReminder(id, { channel, clock: readNow, sendTimeoutMs });
    results[outcome] = (results[outcome] || 0) + 1;
  }
  return results;
}

// Mesmo padrão dos demais monitores em processo (server.js). Um tick por
// minuto lendo só o índice (status, dueAt): sem polling pesado.
function startAfterHoursReminderWorker({ channel, intervalMs = 60 * 1000, onChange } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const results = await processDueReminders({ channel });
      if (results.SENT || results.FAILED || results.UNKNOWN) onChange?.(results);
    } catch (error) {
      console.error("[AFTER_HOURS] worker de lembretes falhou (próximo tick tenta de novo):", error.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  run();
  return () => clearInterval(timer);
}

// ------------------------------------------------------------ Monitoramento

const STATUSES = ["PENDING", "PROCESSING", "SENT", "CANCELLED", "SKIPPED", "FAILED", "UNKNOWN"];

async function monitorScope(viewer, company) {
  await settingsService.assertCanView(viewer);
  const companyId = await settingsService.resolveCompany(viewer, company);
  const companyIds = companyId ? [companyId] : await settingsService.viewableCompanyIds(viewer);
  const authorization = require("./authorization-service");
  // Supervisor: só conversas que já pode ver (respeita setores protegidos).
  const conversationScope = authorization.isMaster(viewer) ? null : await authorization.conversationScope(viewer);
  return { companyId: { in: companyIds }, ...(conversationScope ? { conversation: { is: conversationScope } } : {}) };
}

function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length > 4 ? `•••• ${digits.slice(-4)}` : digits;
}

async function getMonitor(viewer, { company, status, limit = 50, days = 7 } = {}) {
  const scope = await monitorScope(viewer, company);
  const since = new Date(Date.now() - Math.min(Math.max(Number(days) || 7, 1), 90) * 24 * 60 * MINUTE);
  const recent = { ...scope, OR: [{ status: { in: ["PENDING", "PROCESSING"] } }, { updatedAt: { gte: since } }] };
  const [grouped, windowSkips, next, rows] = await Promise.all([
    prisma.afterHoursReminder.groupBy({ by: ["status"], where: recent, _count: { _all: true } }),
    prisma.afterHoursReminder.count({ where: { ...recent, status: "SKIPPED", reason: { startsWith: "WINDOW_" } } }),
    prisma.afterHoursReminder.findFirst({ where: { ...scope, status: "PENDING" }, orderBy: { dueAt: "asc" }, select: { dueAt: true } }),
    prisma.afterHoursReminder.findMany({
      where: { ...recent, ...(STATUSES.includes(status) ? { status } : {}) },
      orderBy: [{ updatedAt: "desc" }], take: Math.min(Math.max(Number(limit) || 50, 1), 200),
      include: {
        message: { select: { status: true } },
        conversation: { select: { id: true, companyId: true, status: true, contact: { select: { name: true, customName: true, phone: true } } } },
      },
    }),
  ]);
  const accountIds = [...new Set(rows.map((row) => row.channelAccountId).filter(Boolean))];
  const accounts = accountIds.length ? await prisma.channelAccount.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } }) : [];
  const accountName = new Map(accounts.map((account) => [account.id, account.name]));
  const counts = Object.fromEntries(STATUSES.map((key) => [key, 0]));
  for (const row of grouped) counts[row.status] = row._count._all;
  return {
    days: Number(days) || 7, counts, skippedWindow: windowSkips, nextDueAt: next?.dueAt || null,
    reminders: rows.map((row) => ({
      id: row.id, status: row.status, reason: row.reason, reasonDetail: row.reasonDetail,
      dueAt: row.dueAt, referenceAt: row.referenceAt, windowExpiresAt: row.windowExpiresAt, sentAt: row.sentAt, updatedAt: row.updatedAt,
      attempts: row.attempts, rescheduleCount: row.rescheduleCount, metaMessageId: row.metaMessageId,
      deliveryStatus: row.message?.status || null, companyId: row.companyId,
      channelAccountName: row.channelAccountId ? accountName.get(row.channelAccountId) || "Número removido" : "WhatsApp principal",
      conversationId: row.conversation.id, conversationStatus: row.conversation.status,
      contactName: row.conversation.contact.customName || row.conversation.contact.name || maskPhone(row.conversation.contact.phone),
      contactPhone: maskPhone(row.conversation.contact.phone),
    })),
  };
}

async function reminderForAction(id, actor) {
  const reminder = await prisma.afterHoursReminder.findUnique({ where: { id } });
  if (!reminder) throw Object.assign(new Error("Lembrete não encontrado."), { statusCode: 404 });
  await settingsService.assertCanView(actor);
  await settingsService.resolveCompany(actor, reminder.companyId);
  await settingsService.assertCanEdit(actor, reminder.companyId);
  return reminder;
}

// Reprocessamento controlado: só falha CONFIRMADA (nada saiu). Resultado
// desconhecido nunca é reenviado pelo sistema — confira a conversa antes.
async function reprocessReminder(id, actor) {
  const reminder = await reminderForAction(id, actor);
  if (reminder.status === "UNKNOWN") throw Object.assign(new Error("O resultado deste envio é desconhecido: a mensagem pode ter chegado ao cliente. Confira a conversa — o sistema não reenvia para evitar duplicidade."), { statusCode: 409 });
  if (reminder.status !== "FAILED") throw Object.assign(new Error("Só lembretes com falha confirmada podem ser reprocessados."), { statusCode: 409 });
  const updated = await prisma.afterHoursReminder.updateMany({
    where: { id, status: "FAILED" }, data: { status: "PENDING", dueAt: new Date(), reason: "REPROCESS_REQUESTED", reasonDetail: null, sendStartedAt: null },
  });
  if (!updated.count) throw Object.assign(new Error("O lembrete mudou de estado. Atualize a lista."), { statusCode: 409 });
  await require("./audit-service").recordAudit({
    actor, action: "AFTER_HOURS_REMINDER_REPROCESSED", entityType: "AFTER_HOURS_REMINDER", entityId: id, companyId: reminder.companyId,
    summary: "Reprocessou um lembrete fora do expediente com falha confirmada", details: { previousReason: reminder.reason },
  });
  return { ok: true };
}

async function cancelReminder(id, actor) {
  const reminder = await reminderForAction(id, actor);
  const updated = await prisma.afterHoursReminder.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELLED", reason: "MANUAL_CANCEL" } });
  if (!updated.count) throw Object.assign(new Error("Só lembretes pendentes podem ser cancelados."), { statusCode: 409 });
  await require("./audit-service").recordAudit({
    actor, action: "AFTER_HOURS_REMINDER_CANCELLED", entityType: "AFTER_HOURS_REMINDER", entityId: id, companyId: reminder.companyId,
    summary: "Cancelou manualmente um lembrete fora do expediente", details: { conversationId: reminder.conversationId },
  });
  return { ok: true };
}

module.exports = {
  KIND, ORIGIN_LABEL, SYSTEM_TAG,
  cancelPendingForConversation, cancelReminder, cancelSafely, classifySendError, cycleAnchor, getMonitor, isCustomerMessage,
  isReminderMessage, processDueReminders, processReminder, recoverStaleClaims, reprocessReminder, scheduleForInboundMessage,
  startAfterHoursReminderWorker,
};
