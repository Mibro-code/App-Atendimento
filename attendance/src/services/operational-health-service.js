// Monitoramento operacional — saúde de canais/integrações e diagnóstico
// técnico, sempre a partir de EVIDÊNCIAS:
//   - "Configurado/ativo" vem do cadastro do ChannelAccount; nunca é tratado
//     como teste real de envio.
//   - Último webhook: registrado em memória quando um webhook válido
//     (assinatura conferida) chega — vale desde o último reinício do processo
//     e é exibido assim.
//   - Última recebida/enviada/falhas: mensagens gravadas nas conversas mais
//     recentes do número (consulta pelos índices existentes; o recorte é
//     informado na resposta).
// Nada aqui devolve token, segredo, header, conteúdo de mensagem ou dado
// pessoal: erros passam por `sanitizeError`.
const prisma = require("../database/prisma");
const companyService = require("./company-service");
const authorization = require("./authorization-service");

const startedAt = new Date();
const webhooks = new Map(); // chave: channelAccountId ou "channel:<CANAL>"
const RECENT_CONVERSATIONS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

function recordWebhook(channel, channelAccountId = null, at = new Date()) {
  const key = channelAccountId || `channel:${channel}`;
  webhooks.set(key, at);
  if (channelAccountId) webhooks.set(`channel:${channel}`, at);
}

function lastWebhook(channel, channelAccountId) {
  return webhooks.get(channelAccountId) || null;
}

// Remove o que possa ser segredo ou dado pessoal de mensagens de erro de
// provedor/motor antes de exibir.
function sanitizeError(value, max = 200) {
  if (!value) return null;
  return String(value)
    .replace(/Bearer\s+\S+/gi, "Bearer [redigido]")
    .replace(/\b(EAA|EAAB|ya29\.|sk-|xox[bp]-)[A-Za-z0-9._-]+/g, "[token redigido]")
    .replace(/(access_token|token|secret|password|senha|apikey|api_key)=([^&\s]+)/gi, "$1=[redigido]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redigido]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[e-mail]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[número]")
    .slice(0, max);
}

async function accountEvidence(account, now) {
  const conversations = await prisma.conversation.findMany({
    where: { channelAccountId: account.id }, select: { id: true },
    orderBy: { lastMessageAt: "desc" }, take: RECENT_CONVERSATIONS,
  });
  const ids = conversations.map(({ id }) => id);
  if (!ids.length) return { lastInboundAt: null, lastOutboundAt: null, failures24h: 0, sampledConversations: 0 };
  const scoped = { conversationId: { in: ids }, channelAccountId: account.id };
  const [inbound, outbound, failures] = await Promise.all([
    prisma.message.findFirst({ where: { ...scoped, direction: "RECEBIDA" }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
    prisma.message.findFirst({ where: { ...scoped, direction: "ENVIADA", status: { in: ["ENVIADA", "ENTREGUE", "LIDA"] }, externalId: { not: null } }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
    prisma.message.count({ where: { ...scoped, direction: "ENVIADA", status: "FALHOU", occurredAt: { gte: new Date(now.getTime() - DAY_MS) } } }),
  ]);
  return { lastInboundAt: inbound?.occurredAt || null, lastOutboundAt: outbound?.occurredAt || null, failures24h: failures, sampledConversations: ids.length };
}

// Canais das empresas informadas (já filtradas pelo RBAC do painel).
async function getChannelHealth(companyIds, { now = new Date() } = {}) {
  const accounts = await prisma.channelAccount.findMany({
    where: { companyId: { in: companyIds } },
    select: {
      id: true, name: true, channel: true, companyId: true, enabled: true, status: true, config: true,
      lastSyncAt: true, lastErrorAt: true, lastErrorCode: true, lastErrorMessage: true, tokenExpiresAt: true,
      company: { select: { id: true, name: true, slug: true, displayName: true, primaryColor: true, active: true } },
    },
    orderBy: [{ companyId: "asc" }, { channel: "asc" }, { name: "asc" }],
  });
  const rows = [];
  for (const account of accounts) {
    const evidence = await accountEvidence(account, now);
    const configured = account.channel === "META" ? Boolean(account.config?.phoneNumberId) : !["NOT_CONFIGURED", "DISABLED"].includes(account.status);
    const recentError = account.lastErrorAt && now.getTime() - account.lastErrorAt.getTime() < DAY_MS;
    rows.push({
      id: account.id, name: account.name, channel: account.channel,
      company: companyService.publicCompany(account.company),
      displayNumber: account.config?.displayNumber || null,
      enabled: account.enabled, status: account.status, configured,
      lastWebhookAt: lastWebhook(account.channel, account.id),
      lastSyncAt: account.lastSyncAt,
      ...evidence,
      tokenExpiresAt: account.tokenExpiresAt,
      lastError: account.lastErrorAt ? { at: account.lastErrorAt, code: sanitizeError(account.lastErrorCode, 60), message: sanitizeError(account.lastErrorMessage) } : null,
      // Severidade só a partir de evidência (nunca "ok" por estar marcado como conectado).
      health: !account.enabled ? "DISABLED" : !configured ? "NOT_CONFIGURED"
        : (evidence.failures24h || recentError || ["ERROR", "DEGRADED", "RECONNECT_REQUIRED"].includes(account.status)) ? "ATTENTION"
          : evidence.lastOutboundAt || evidence.lastInboundAt ? "ACTIVITY_SEEN" : "NO_EVIDENCE",
    });
  }
  return { generatedAt: now, processStartedAt: startedAt, webhookSince: startedAt, sampleNote: `Mensagens consultadas nas ${RECENT_CONVERSATIONS} conversas mais recentes de cada número.`, accounts: rows };
}

function appVersion() {
  try {
    const source = require("node:fs").readFileSync(require("node:path").join(process.cwd(), "public", "js", "changelog.js"), "utf8");
    return /APP_VERSION\s*=\s*"([^"]+)"/.exec(source)?.[1] || null;
  } catch {
    return null;
  }
}

// Diagnóstico técnico — somente Master.
async function getDiagnostics(viewer, { now = new Date() } = {}) {
  if (!authorization.isMaster(viewer)) throw authorization.forbidden("Somente o Master acessa o diagnóstico técnico.");
  const dbStarted = Date.now();
  let database = { ok: false, latencyMs: null };
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = { ok: true, latencyMs: Date.now() - dbStarted };
  } catch (error) {
    database = { ok: false, latencyMs: null, error: sanitizeError(error.message, 120) };
  }
  let lastMigration = null;
  try {
    const [row] = await prisma.$queryRaw`SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`;
    if (row) lastMigration = { name: row.migration_name, finishedAt: row.finished_at };
  } catch {
    lastMigration = null; // banco sem histórico de migrations (ex.: schema de testes)
  }
  const since = new Date(now.getTime() - DAY_MS);
  const [timersPending, timersLate, flowFailures, recentFlowErrors, campaignSettings, campaignQueued, campaignFailed, botSettings, followUpWorker] = await Promise.all([
    prisma.botFlowExecution.count({ where: { status: "WAITING_TIMER" } }),
    prisma.botFlowExecution.count({ where: { status: "WAITING_TIMER", resumeAt: { lt: new Date(now.getTime() - 5 * 60000) } } }),
    prisma.botFlowExecution.count({ where: { status: "FAILED", updatedAt: { gte: since } } }),
    prisma.botFlowExecution.findMany({ where: { status: "FAILED", updatedAt: { gte: since } }, select: { id: true, updatedAt: true, error: true, currentNodeKey: true }, orderBy: { updatedAt: "desc" }, take: 10 }),
    prisma.campaignGlobalSettings.findFirst({ select: { massMessagingEnabled: true } }).catch(() => null),
    prisma.campaignContact.count({ where: { status: { in: ["QUEUED", "SENDING"] } } }).catch(() => null),
    prisma.campaignContact.count({ where: { status: "FAILED", updatedAt: { gte: since } } }).catch(() => null),
    prisma.botGlobalSettings.findFirst({ select: { automationEnabled: true, killSwitchActivatedAt: true } }).catch(() => null),
    Promise.resolve(require("./follow-up-service").workerStatus()),
  ]);
  return {
    generatedAt: now,
    app: { version: appVersion(), node: process.version, startedAt, uptimeSeconds: Math.round(process.uptime()) },
    database: { ...database, lastMigration },
    jobs: {
      // Workers em processo sem telemetria própria aparecem como tal — sem
      // inventar "ok". Evidência indireta: timers do Flow Builder atrasados.
      flowTimers: { pending: timersPending, late: timersLate },
      followUpReminders: followUpWorker ? { lastTickAt: followUpWorker.at, ok: followUpWorker.ok, error: sanitizeError(followUpWorker.error) } : { lastTickAt: null, ok: null },
      others: "Inatividade, SLA, campanhas e Gmail não registram execução (sem telemetria).",
    },
    automation: {
      botsEnabled: botSettings ? Boolean(botSettings.automationEnabled) && !botSettings.killSwitchActivatedAt : null,
      massMessagingEnabled: campaignSettings ? Boolean(campaignSettings.massMessagingEnabled) : false,
      campaignQueue: campaignQueued, campaignFailures24h: campaignFailed,
    },
    errors: {
      flowFailures24h: flowFailures,
      recent: recentFlowErrors.map((row) => ({ source: "Flow Builder", at: row.updatedAt, node: row.currentNodeKey, message: sanitizeError(row.error) })),
    },
  };
}

module.exports = { getChannelHealth, getDiagnostics, recordWebhook, sanitizeError };
