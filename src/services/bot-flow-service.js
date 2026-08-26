// Flow Engine: conduz uma BotIntent por várias etapas configuráveis em vez
// de responder uma única vez. Reaproveita o que já existe (nunca duplica
// regras de segurança):
//   - Tools continuam validadas/executadas só por resolveToolDecision()
//     (bot-tool-orchestrator-service.js) — bloqueio por desativada/sem
//     permissão/entidade faltando é o MESMO caminho de sempre.
//   - Base de Conhecimento continua vindo de KnowledgeSourceProvider
//     (bot-knowledge/knowledge-provider.js) — nunca inventa conteúdo.
//   - "sim"/"não"/frases de resolução reaproveitam os padrões já existentes
//     em bot-constants.js (CONFIRMATION_PATTERN/NEGATION_PATTERN/
//     RESOLUTION_POSITIVE_PATTERNS/RESOLUTION_NEGATIVE_PATTERNS).
//
// Uma BotIntent sem nenhuma BotFlowStep ativa continua exatamente como antes
// (responseMessage/toolName/Base de Conhecimento de intenção, resposta única)
// — o motor só assume quando existem etapas ativas para a intenção decidida.
const prisma = require("../database/prisma");
const { normalizeText } = require("./bot-simulator-service");
const {
  CONFIRMATION_PATTERN, NEGATION_PATTERN, RESOLUTION_NEGATIVE_PATTERNS, RESOLUTION_POSITIVE_PATTERNS,
} = require("./bot-constants");
const { resolveToolDecision } = require("./bot-tool-orchestrator-service");
const { isActiveNow } = require("./bot-knowledge-source-service");
const { KnowledgeSourceProvider } = require("./bot-knowledge/knowledge-provider");

const defaultKnowledgeProvider = new KnowledgeSourceProvider();

// Segurança (item 9): nunca encadear etapas automáticas indefinidamente —
// GOTO_STEP mal configurado (ciclo) sempre acaba em handoff, nunca trava.
const MAX_CHAIN_STEPS = 12;
const DEFAULT_MAX_ATTEMPTS = 3;

const flowStepSelect = {
  id: true, intentId: true, name: true, order: true, action: true, question: true, entityKey: true,
  required: true, knowledgeSourceId: true, toolName: true, responseMessage: true,
  nextStepId: true, onSuccessStepId: true, onFailureStepId: true, gotoStepId: true, maxAttempts: true,
  active: true, createdAt: true, updatedAt: true,
};

// ---------------------------------------------------------------------------
// CRUD (usado pela tela "Fluxo de atendimento" da intenção)
// ---------------------------------------------------------------------------

async function listFlowSteps(intentId, client = prisma) {
  return client.botFlowStep.findMany({ where: { intentId }, orderBy: { order: "asc" }, select: flowStepSelect });
}

async function getActiveOrderedSteps(intentId, client = prisma) {
  return client.botFlowStep.findMany({
    where: { intentId, active: true }, orderBy: { order: "asc" }, select: flowStepSelect,
  });
}

async function hasActiveFlow(intentId, client = prisma) {
  const count = await client.botFlowStep.count({ where: { intentId, active: true } });
  return count > 0;
}

function nextOrderFor(existingSteps) {
  return existingSteps.reduce((max, step) => Math.max(max, step.order), 0) + 1;
}

async function assertStepBelongsToIntent(intentId, stepId, client) {
  if (!stepId) return true;
  const step = await client.botFlowStep.findUnique({ where: { id: stepId }, select: { intentId: true } });
  return Boolean(step && step.intentId === intentId);
}

function flowStepInput(body = {}) {
  return {
    name: String(body.name || "").trim().slice(0, 120),
    action: body.action,
    question: body.question ? String(body.question).trim().slice(0, 1000) : null,
    entityKey: body.entityKey ? String(body.entityKey).trim().slice(0, 60) : null,
    required: body.required !== false,
    knowledgeSourceId: body.knowledgeSourceId || null,
    toolName: body.toolName ? String(body.toolName).trim() : null,
    responseMessage: body.responseMessage ? String(body.responseMessage).trim().slice(0, 4000) : null,
    nextStepId: body.nextStepId || null,
    onSuccessStepId: body.onSuccessStepId || null,
    onFailureStepId: body.onFailureStepId || null,
    gotoStepId: body.gotoStepId || null,
    maxAttempts: Number.isFinite(Number(body.maxAttempts)) ? Math.min(10, Math.max(1, Number(body.maxAttempts))) : DEFAULT_MAX_ATTEMPTS,
    active: body.active !== false,
  };
}

const FLOW_STEP_ACTIONS = ["ASK_QUESTION", "USE_KNOWLEDGE", "QUERY_TOOL", "RESPOND", "RESOLVED", "HANDOFF_HUMAN", "GOTO_STEP"];

async function createFlowStep(intentId, body, client = prisma) {
  const data = flowStepInput(body);
  if (!data.name) throw Object.assign(new Error("Informe um nome para a etapa."), { statusCode: 400 });
  if (!FLOW_STEP_ACTIONS.includes(data.action)) throw Object.assign(new Error("Ação inválida."), { statusCode: 400 });

  for (const field of ["nextStepId", "onSuccessStepId", "onFailureStepId", "gotoStepId"]) {
    if (data[field] && !(await assertStepBelongsToIntent(intentId, data[field], client))) {
      throw Object.assign(new Error("A etapa de destino não pertence a esta intenção."), { statusCode: 400 });
    }
  }

  const existing = await listFlowSteps(intentId, client);
  return client.botFlowStep.create({
    data: { ...data, intentId, order: nextOrderFor(existing) },
    select: flowStepSelect,
  });
}

async function updateFlowStep(stepId, body, client = prisma) {
  const current = await client.botFlowStep.findUnique({ where: { id: stepId } });
  if (!current) throw Object.assign(new Error("Etapa não encontrada."), { statusCode: 404 });

  const data = flowStepInput({ ...current, ...body });
  if (!data.name) throw Object.assign(new Error("Informe um nome para a etapa."), { statusCode: 400 });
  if (!FLOW_STEP_ACTIONS.includes(data.action)) throw Object.assign(new Error("Ação inválida."), { statusCode: 400 });

  for (const field of ["nextStepId", "onSuccessStepId", "onFailureStepId", "gotoStepId"]) {
    if (data[field] === stepId) throw Object.assign(new Error("Uma etapa não pode apontar para ela mesma."), { statusCode: 400 });
    if (data[field] && !(await assertStepBelongsToIntent(current.intentId, data[field], client))) {
      throw Object.assign(new Error("A etapa de destino não pertence a esta intenção."), { statusCode: 400 });
    }
  }

  return client.botFlowStep.update({ where: { id: stepId }, data, select: flowStepSelect });
}

async function deleteFlowStep(stepId, client = prisma) {
  const current = await client.botFlowStep.findUnique({ where: { id: stepId }, select: { id: true } });
  if (!current) throw Object.assign(new Error("Etapa não encontrada."), { statusCode: 404 });
  await client.botFlowStep.delete({ where: { id: stepId } });
  return { deleted: true };
}

// Reordena TODAS as etapas ativas/inativas da intenção conforme a lista de
// ids recebida (drag-and-drop na UI) — ids fora da lista mantêm a ordem
// relativa ao final.
async function reorderFlowSteps(intentId, orderedStepIds, client = prisma) {
  const steps = await listFlowSteps(intentId, client);
  const known = new Set(steps.map((step) => step.id));
  const finalOrder = [
    ...orderedStepIds.filter((id) => known.has(id)),
    ...steps.map((step) => step.id).filter((id) => !orderedStepIds.includes(id)),
  ];
  // Duas passagens: `order` tem @@unique([intentId, order]) — atribuir os
  // valores finais direto colidiria em cima dos valores atuais (ex.: mover o
  // 1º item para a posição 3 enquanto outro item ainda está com order=3).
  // Passa por um intervalo negativo temporário primeiro para nunca colidir.
  await client.$transaction([
    ...finalOrder.map((id, index) => client.botFlowStep.update({ where: { id }, data: { order: -(index + 1) } })),
    ...finalOrder.map((id, index) => client.botFlowStep.update({ where: { id }, data: { order: index + 1 } })),
  ]);
  return listFlowSteps(intentId, client);
}

// ---------------------------------------------------------------------------
// Interpretação de resposta curta no contexto da etapa atual (itens 5/6)
// ---------------------------------------------------------------------------

// Reconhece frases de resolução (item 6) — mesma fonte de padrões usada em
// todo o restante do motor de Bots (bot-constants.js), nunca duplicada aqui.
function detectFlowOutcome(message) {
  const normalized = normalizeText(message);
  if (!normalized) return null;
  // Negativo primeiro de propósito: frases como "não funcionou" contêm a
  // palavra "funcionou" (padrão positivo) dentro de uma negação — checar o
  // negativo antes evita interpretar isso como resolvido.
  if (RESOLUTION_NEGATIVE_PATTERNS.some((pattern) => pattern.test(normalized))) return "NOT_RESOLVED";
  if (RESOLUTION_POSITIVE_PATTERNS.some((pattern) => pattern.test(normalized))) return "RESOLVED";
  return null;
}

// Mais tolerante que CONFIRMATION_PATTERN/NEGATION_PATTERN (que só casam a
// mensagem inteira): uma etapa de confirmação do fluxo ("aparece no
// Bluetooth?") recebe respostas como "não, não aparece" — o padrão exato
// de mensagem curta continua checado primeiro (reaproveitado), com um
// fallback léxico simples (primeira palavra) só para este contexto.
function detectYesNo(message) {
  const normalized = normalizeText(message);
  if (!normalized) return null;
  if (CONFIRMATION_PATTERN.test(normalized)) return "YES";
  if (NEGATION_PATTERN.test(normalized)) return "NO";
  if (/^sim\b/.test(normalized)) return "YES";
  if (/^(nao|n)\b/.test(normalized)) return "NO";
  return null;
}

// ---------------------------------------------------------------------------
// Motor de execução
// ---------------------------------------------------------------------------

function emptyFlowState(intentId) {
  return {
    intentId,
    collectedEntities: {},
    askedQuestions: [],
    attemptedSolutions: [],
    failedSteps: [],
    stepAttempts: {},
  };
}

function cloneFlowState(state, intentId) {
  if (!state || state.activeFlowIntentId !== intentId) return emptyFlowState(intentId);
  return {
    intentId,
    collectedEntities: { ...(state.flowCollectedEntities || {}) },
    askedQuestions: [...(state.flowAskedQuestions || [])],
    attemptedSolutions: [...(state.flowAttemptedSolutions || [])],
    failedSteps: [...(state.flowFailedSteps || [])],
    stepAttempts: { ...(state.flowStepAttempts || {}) },
  };
}

function toFlowPersist(flowState, currentStepId, resolutionStatus) {
  return {
    intentId: flowState.intentId,
    currentStepId: currentStepId || null,
    collectedEntities: flowState.collectedEntities,
    askedQuestions: flowState.askedQuestions,
    attemptedSolutions: flowState.attemptedSolutions,
    failedSteps: flowState.failedSteps,
    stepAttempts: flowState.stepAttempts,
    resolutionStatus,
  };
}

function recordAttempt(flowState, step, outcome) {
  flowState.attemptedSolutions.push({ stepId: step.id, name: step.name, action: step.action, outcome, at: new Date().toISOString() });
  if (outcome === "FAILURE" && !flowState.failedSteps.includes(step.id)) flowState.failedSteps.push(step.id);
}

// Etapa que aguarda resposta do cliente: entidade livre (entityKey) ou
// confirmação sim/não (sem entityKey — ex.: "funcionou?"). Nunca conta como
// falha "silenciosa": esgotar as tentativas sempre encaminha para humano
// (item 9), nunca fica repetindo a pergunta para sempre.
function evaluateAskQuestionAnswer(step, message, flowState) {
  const attempts = (flowState.stepAttempts[step.id] || 0) + 1;
  flowState.stepAttempts[step.id] = attempts;
  const trimmed = String(message || "").trim();
  const maxAttempts = step.maxAttempts || DEFAULT_MAX_ATTEMPTS;

  if (step.entityKey) {
    if (trimmed) {
      flowState.collectedEntities[step.entityKey] = trimmed;
      return "SUCCESS";
    }
    if (!step.required) return "SUCCESS";
    return attempts >= maxAttempts ? "MAX_ATTEMPTS" : "RETRY";
  }

  const outcome = detectFlowOutcome(trimmed) === "RESOLVED" || detectYesNo(trimmed) === "YES" ? "SUCCESS"
    : detectFlowOutcome(trimmed) === "NOT_RESOLVED" || detectYesNo(trimmed) === "NO" ? "FAILURE"
      : null;
  if (outcome) return outcome;
  return attempts >= maxAttempts ? "MAX_ATTEMPTS" : "RETRY";
}

async function resolveStepKnowledgeText({ step, bot, intent, client }) {
  if (step.knowledgeSourceId) {
    const row = await client.knowledgeSource.findUnique({ where: { id: step.knowledgeSourceId } });
    if (row && row.active && isActiveNow(row)) return row.content || null;
    return null;
  }
  try {
    // Sem trecho de busca natural aqui (a etapa decide sozinha buscar
    // conhecimento, não é uma resposta livre do cliente) — string vazia usa
    // o score padrão do provider e deixa o filtro por intentId (mais preciso
    // neste contexto) decidir a relevância, em vez de comparar contra a
    // última resposta curta do cliente ("sim"/"não"/etc.).
    const results = await defaultKnowledgeProvider.search("", {
      botId: bot.id, intentId: intent.id, globalIntentId: intent.globalIntentId || null,
    });
    return results[0]?.content || null;
  } catch (error) {
    // Nunca derruba o fluxo por falha na busca — degrada para "sem conteúdo".
    console.error("[BOT_FLOW] falha ao buscar conhecimento da etapa (ignorada)", error.message);
    return null;
  }
}

// Reaproveita INTEGRALMENTE a validação/execução de Tools já existente
// (bot-tool-orchestrator-service.js): desativada, sem permissão, entidade
// obrigatória faltando etc. continuam bloqueando exatamente como no modo
// single-shot — o Flow Engine não reimplementa essa checagem.
async function resolveStepTool({ step, bot, flowState, channel, mode }) {
  const decision = await resolveToolDecision({
    bot,
    decision: { action: "QUERY_TOOL", toolName: step.toolName, entities: flowState.collectedEntities, summary: "" },
    channel,
    mode,
  });
  if (decision.toolResponseText) return { text: decision.toolResponseText, success: true };
  return { text: null, success: false, reason: decision.toolUnavailableReason || decision.clarificationQuestion || "TOOL_UNAVAILABLE" };
}

function resolveNextStepId(step, outcome) {
  if (outcome === "SUCCESS") return step.onSuccessStepId || step.nextStepId || null;
  if (outcome === "FAILURE") return step.onFailureStepId || step.nextStepId || null;
  return step.nextStepId || null;
}

// Percorre etapas automáticas (USE_KNOWLEDGE/QUERY_TOOL/RESPOND/GOTO_STEP)
// encadeadas até: precisar esperar uma resposta (ASK_QUESTION), terminar
// (RESOLVED/HANDOFF_HUMAN) ou esgotar o limite de segurança do encadeamento.
async function runChain({ bot, intent, stepMap, startStepId, flowState, channel, mode, client, message }) {
  const responses = [];
  let stepId = startStepId;
  let iterations = 0;

  while (stepId && iterations < MAX_CHAIN_STEPS) {
    iterations += 1;
    const step = stepMap.get(stepId);
    if (!step || !step.active) {
      // Etapa-alvo ausente/desativada: nunca trava o cliente sem resposta —
      // encaminha para humano (item 9).
      return {
        responseText: [...responses, "Vou te encaminhar para um de nossos atendentes para continuar."].join("\n\n"),
        terminal: "HANDOFF",
        summary: "Etapa de destino do fluxo não está mais disponível; encaminhado para humano.",
        flow: toFlowPersist(flowState, null, "HANDED_OFF"),
      };
    }

    if (step.action === "ASK_QUESTION") {
      // Item 1: não repetir pergunta cuja resposta já foi coletada.
      if (step.entityKey && flowState.collectedEntities[step.entityKey]) {
        stepId = resolveNextStepId(step, "SUCCESS");
        continue;
      }
      if (!flowState.askedQuestions.includes(step.id)) flowState.askedQuestions.push(step.id);
      responses.push(step.question || step.name);
      return {
        responseText: responses.join("\n\n"),
        terminal: null,
        summary: `Aguardando resposta da etapa "${step.name}".`,
        flow: toFlowPersist(flowState, step.id, "IN_PROGRESS"),
      };
    }

    if (step.action === "USE_KNOWLEDGE") {
      const text = await resolveStepKnowledgeText({ step, bot, intent, client });
      recordAttempt(flowState, step, text ? "SUCCESS" : "FAILURE");
      if (text) responses.push(text);
      stepId = resolveNextStepId(step, text ? "SUCCESS" : "FAILURE");
      continue;
    }

    if (step.action === "QUERY_TOOL") {
      const result = await resolveStepTool({ step, bot, flowState, channel, mode });
      recordAttempt(flowState, step, result.success ? "SUCCESS" : "FAILURE");
      if (result.success) responses.push(result.text);
      stepId = resolveNextStepId(step, result.success ? "SUCCESS" : "FAILURE");
      continue;
    }

    if (step.action === "RESPOND") {
      if (step.responseMessage) responses.push(step.responseMessage);
      recordAttempt(flowState, step, "SUCCESS");
      stepId = resolveNextStepId(step, "SUCCESS");
      continue;
    }

    if (step.action === "GOTO_STEP") {
      stepId = step.gotoStepId;
      continue;
    }

    if (step.action === "RESOLVED") {
      if (step.responseMessage) responses.push(step.responseMessage);
      return {
        responseText: responses.join("\n\n") || "Que bom que conseguimos resolver! Qualquer coisa, é só chamar.",
        terminal: "RESOLVED",
        summary: `Fluxo da intenção "${intent.name}" concluído como resolvido.`,
        flow: toFlowPersist(flowState, null, "RESOLVED"),
      };
    }

    if (step.action === "HANDOFF_HUMAN") {
      responses.push(step.responseMessage || "Vou te encaminhar para um de nossos atendentes, só um instante.");
      return {
        responseText: responses.join("\n\n"),
        terminal: "HANDOFF",
        summary: `Fluxo da intenção "${intent.name}" encaminhado para atendimento humano.`,
        flow: toFlowPersist(flowState, null, "HANDED_OFF"),
      };
    }

    // Ação desconhecida (defensivo): nunca trava — encaminha para humano.
    stepId = null;
  }

  // Encadeamento esgotado (loop de GOTO_STEP mal configurado) ou fim da
  // cadeia sem terminal explícito: nunca deixa o cliente sem resposta nem
  // fica girando — encaminha para humano.
  return {
    responseText: [...responses, "Vou te encaminhar para um de nossos atendentes para continuar."].join("\n\n"),
    terminal: "HANDOFF",
    summary: iterations >= MAX_CHAIN_STEPS
      ? "Limite de segurança de etapas encadeadas atingido; encaminhado para humano."
      : `Fluxo da intenção "${intent.name}" chegou ao fim sem uma conclusão explícita; encaminhado para humano.`,
    flow: toFlowPersist(flowState, null, "HANDED_OFF"),
  };
}

// Inicia o fluxo de uma intenção pela primeira vez nesta conversa (chamado
// quando decide() resolveu RESPOND/QUERY_TOOL para uma intenção que tem
// etapas ativas configuradas).
async function startFlow({ bot, intent, channel, mode, client = prisma }) {
  const steps = await getActiveOrderedSteps(intent.id, client);
  if (!steps.length) return null;
  const stepMap = new Map(steps.map((step) => [step.id, step]));
  const flowState = emptyFlowState(intent.id);
  return runChain({ bot, intent, stepMap, startStepId: steps[0].id, flowState, channel, mode, client, message: null });
}

// Continua um fluxo já em andamento: interpreta `message` como resposta à
// etapa atual (`state.currentFlowStepId`) e avança.
async function continueFlow({ bot, intent, message, state, channel, mode, client = prisma }) {
  const steps = await getActiveOrderedSteps(intent.id, client);
  const stepMap = new Map(steps.map((step) => [step.id, step]));
  const currentStep = stepMap.get(state.currentFlowStepId);
  const flowState = cloneFlowState(state, intent.id);

  if (!currentStep || !currentStep.active) {
    return {
      responseText: "Vou te encaminhar para um de nossos atendentes para continuar.",
      terminal: "HANDOFF",
      summary: "A etapa atual do fluxo não está mais disponível.",
      flow: toFlowPersist(flowState, null, "HANDED_OFF"),
    };
  }

  if (currentStep.action !== "ASK_QUESTION") {
    // Só etapas ASK_QUESTION pausam esperando o cliente — qualquer outra
    // situação aqui é defensiva (estado inconsistente), nunca trava.
    return runChain({
      bot, intent, stepMap, startStepId: currentStep.id, flowState, channel, mode, client, message,
    });
  }

  const outcome = evaluateAskQuestionAnswer(currentStep, message, flowState);

  if (outcome === "RETRY") {
    return {
      responseText: currentStep.question || currentStep.name,
      terminal: null,
      summary: `Resposta não compreendida na etapa "${currentStep.name}"; repetindo a pergunta.`,
      flow: toFlowPersist(flowState, currentStep.id, "IN_PROGRESS"),
    };
  }

  if (outcome === "MAX_ATTEMPTS") {
    recordAttempt(flowState, currentStep, "FAILURE");
    return {
      responseText: "Vou te encaminhar para um de nossos atendentes para continuar te ajudando.",
      terminal: "HANDOFF",
      summary: `Número máximo de tentativas atingido na etapa "${currentStep.name}"; encaminhado para humano.`,
      flow: toFlowPersist(flowState, null, "HANDED_OFF"),
    };
  }

  recordAttempt(flowState, currentStep, outcome);
  const nextStepId = resolveNextStepId(currentStep, outcome);
  return runChain({ bot, intent, stepMap, startStepId: nextStepId, flowState, channel, mode, client, message });
}

module.exports = {
  FLOW_STEP_ACTIONS,
  listFlowSteps,
  getActiveOrderedSteps,
  hasActiveFlow,
  createFlowStep,
  updateFlowStep,
  deleteFlowStep,
  reorderFlowSteps,
  detectFlowOutcome,
  detectYesNo,
  startFlow,
  continueFlow,
};
