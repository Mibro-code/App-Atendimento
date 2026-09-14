const { interpret } = require("./bot-interpreter-service");
const { normalizeText } = require("./bot-simulator-service");
const { normalizeCaseState, mergeCaseState, recordQuestionAsked } = require("./bot-case-state-service");
const { KnowledgeSourceProvider } = require("./bot-knowledge/knowledge-provider");

const ASSISTANT_ID = "mibro-assistant-observer";
const MAX_QUESTIONS = 5;

const RULES = Object.freeze({
  SUPORTE: [
    ["CARREGAMENTO", /\b(nao carrega|n carrega|carregador|carregamento|base de carga|cabo)\b/],
    ["CONEXAO", /\b(nao conecta|n conecta|conectar|conexao|parear|pareia|bluetooth|sincroniz)\w*/],
    ["NOTIFICACOES", /\b(notifica|mensagem|whatsapp|ligacao|chamada)\w*/],
    ["APP", /\b(app|aplicativo|mibro fit|login|conta)\b/],
    ["GPS", /\b(gps|localizacao|rota|distancia)\b/],
    ["BATERIA", /\b(bateria|descarrega|duracao|autonomia|nao liga|n liga)\b/],
    ["TELA", /\b(tela|display|touch|quebrou|trincou)\b/],
    ["GARANTIA", /\b(garantia|defeito|assistencia tecnica|reparo)\b/],
  ],
  ATENDIMENTO: [
    ["PEDIDO", /\b(pedido|rastreio|rastrear|entrega|nao chegou|n chegou|atras)\w*/],
    ["NOTA_FISCAL", /\b(nota fiscal|nf|danfe)\b/],
    ["TROCA", /\b(troca|trocar|devolu|reembolso|estorno)\w*/],
  ],
  COMERCIAL: [
    ["ESCOLHA_PRODUTO", /\b(qual (relogio|modelo)|recomenda|melhor modelo|escolher|comparar)\b/],
    ["GPS", /\b(gps|localizacao|rota)\b/],
    ["COMPRA", /\b(comprar|preco|valor|disponivel|estoque|onde compra)\b/],
  ],
  PARCERIAS: [
    ["REVENDA", /\b(revender|revenda|distribuidor|tenho (uma )?loja|lojista|atacado)\b/],
    ["PARCERIA", /\b(parceria|influenciador|afiliado|representante|creator)\b/],
  ],
});

const QUESTIONS = Object.freeze({
  product: "Qual é o modelo exato do seu Mibro?",
  purchase: "Você possui nota fiscal e comprou por qual loja ou canal?",
  purchaseDateApprox: "Aproximadamente quando a compra foi feita?",
  appOs: "Qual aplicativo e celular você usa: Mibro Fit em Android ou iPhone?",
  orderNumber: "Pode informar o número do pedido?",
  objective: "Conte em uma frase o que você precisa para eu encaminhar com o contexto certo.",
});

function isSectorIntakeBot(bot) {
  return bot?.id === ASSISTANT_ID || bot?.featureFlags?.sectorIntakeEnabled === true;
}

function categoryFamily(category) {
  const raw = category?.parent?.code || category?.parent?.name || category?.code || category?.name || "";
  const value = normalizeText(raw).toUpperCase();
  if (value.includes("SUPORTE")) return "SUPORTE";
  if (value.includes("ATENDIMENTO")) return "ATENDIMENTO";
  if (value.includes("COMERCIAL")) return "COMERCIAL";
  if (value.includes("PARCER")) return "PARCERIAS";
  return null;
}

function detectIssue(sector, message) {
  const text = normalizeText(message);
  const match = (RULES[sector] || []).find(([, pattern]) => pattern.test(text));
  return match?.[0] || null;
}

function canonicalizeIssue(value) {
  const text = normalizeText(value || "");
  if (/carreg|bateria/.test(text)) return text.includes("bateria") ? "BATERIA" : "CARREGAMENTO";
  if (/conex|parea|bluetooth/.test(text)) return "CONEXAO";
  if (/notifica/.test(text)) return "NOTIFICACOES";
  if (/aplicativo|\bapp\b/.test(text)) return "APP";
  if (/\bgps\b/.test(text)) return "GPS";
  if (/tela|display/.test(text)) return "TELA";
  if (/garantia|defeito/.test(text)) return "GARANTIA";
  if (/pedido|entrega/.test(text)) return "PEDIDO";
  if (/nota fiscal/.test(text)) return "NOTA_FISCAL";
  if (/troca|devolu|reembolso/.test(text)) return "TROCA";
  if (/produto|modelo/.test(text)) return "ESCOLHA_PRODUTO";
  if (/revenda|revendedor/.test(text)) return "REVENDA";
  if (/parceria/.test(text)) return "PARCERIA";
  return null;
}

function detectProduct(message) {
  const text = normalizeText(message);
  const known = [
    ["GS Pro 2", /\bgs pro 2\b/], ["GS Active 2", /\bgs active 2\b/],
    ["GS Active", /\bgs active\b/], ["GS Pro", /\bgs pro\b/],
    ["Lite 3 Pro", /\blite 3 pro\b/], ["Lite 3", /\blite 3\b/],
    ["C4", /\bc ?4\b/], ["A3", /\ba ?3\b/],
  ];
  return known.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

function extractPatch(message, current) {
  const text = normalizeText(message);
  const patch = {};
  const product = detectProduct(message);
  if (product) patch.product = product;
  if (/\b(mibro fit|aplicativo|app)\b/.test(text)) patch.app = text.includes("mibro fit") ? "Mibro Fit" : "Aplicativo nao informado";
  if (/\b(android|samsung|motorola|xiaomi)\b/.test(text)) patch.os = "Android";
  if (/\b(iphone|ios)\b/.test(text)) patch.os = "iOS";
  if (/\b(amazon|mercado livre|shopee|site|loja oficial|magalu|marketplace)\b/.test(text)) {
    patch.purchaseChannel = message.match(/amazon|mercado livre|shopee|site|loja oficial|magalu|marketplace/i)?.[0] || message;
  }
  if (/\b(tenho|possuo|com|sim)\b.*\b(nota fiscal|nf)\b/.test(text)) patch.hasInvoice = true;
  if (/\b(nao tenho|n tenho|sem)\b.*\b(nota fiscal|nf)\b/.test(text)) patch.hasInvoice = false;
  const date = message.match(/\b(?:ha\s+)?\d+\s+(?:dia|dias|mes|meses|ano|anos)\b|\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/i);
  if (date) patch.purchaseDateApprox = date[0];
  const order = message.match(/\b(?:pedido|ordem|order)\s*[#:]?\s*([A-Z0-9-]{5,})\b/i);
  if (order) patch.orderNumber = order[1];

  if (current.pendingField === "product" && !patch.product && message.trim().length <= 50) patch.product = message.trim();
  if (current.pendingField === "purchase" && patch.hasInvoice == null && /\b(sim|tenho|possuo)\b/.test(text)) patch.hasInvoice = true;
  if (current.pendingField === "purchase" && patch.hasInvoice == null && /\b(nao|n|sem)\b/.test(text)) patch.hasInvoice = false;
  if (current.pendingField === "purchaseDateApprox" && !patch.purchaseDateApprox) patch.purchaseDateApprox = message.trim();
  if (current.pendingField === "orderNumber" && !patch.orderNumber) patch.orderNumber = message.trim();
  if (current.pendingField === "objective") patch.objective = message.trim();
  if (current.pendingField === "appOs") {
    if (!patch.app && /\bmibro\b/.test(text)) patch.app = message.trim();
    if (!patch.os) patch.phone = message.trim();
  }
  if (/\b(ja tentei|ja fiz|tentei|reiniciei|resetei|desinstalei)\b/.test(text)) {
    patch.solutionsTried = [{ description: message.trim(), outcome: "UNKNOWN" }];
  }
  return patch;
}

function requiredFields(sector, issue) {
  if (sector === "SUPORTE") {
    if (["CONEXAO", "APP", "NOTIFICACOES", "GPS"].includes(issue)) return ["product", "appOs"];
    return ["product", "purchase", "purchaseDateApprox"];
  }
  if (sector === "ATENDIMENTO") return issue === "PEDIDO" ? ["orderNumber"] : ["objective"];
  return ["objective"];
}

function missingField(caseState, fields) {
  return fields.find((field) => {
    if (field === "purchase") return caseState.hasInvoice == null || !caseState.purchaseChannel;
    if (field === "appOs") return !caseState.app || !caseState.os;
    return !caseState[field];
  }) || null;
}

function questionFor(field, caseState) {
  if (field === "purchase") {
    if (caseState.hasInvoice != null && !caseState.purchaseChannel) return "Por qual loja ou canal a compra foi feita?";
    if (caseState.purchaseChannel && caseState.hasInvoice == null) return "Você possui a nota fiscal da compra?";
  }
  if (field === "appOs") {
    if (caseState.app && !caseState.os) return "Seu celular usa Android ou iPhone (iOS)?";
    if (caseState.os && !caseState.app) return "Qual aplicativo você usa com o Mibro?";
  }
  return QUESTIONS[field];
}

function interpretationFor({ issue, confidence, provider, calledExternalAi = false, aiUsage = null, category }) {
  return {
    intentId: null, intentName: issue, confidence, matchedExample: null, entities: {},
    provider, status: issue ? "OK" : "UNKNOWN", errorCode: null, socialBehavior: null,
    calledExternalAi, aiUsage, sector: categoryFamily(category), issue,
  };
}

async function classifyWithFallback({ bot, message, context, state, flags, sector }) {
  const localIssue = detectIssue(sector, message);
  if (localIssue) return { issue: localIssue, confidence: 0.96, provider: "LOCAL_RULES", raw: null };
  const scopedIntents = (bot.intents || []).filter((intent) => {
    const family = categoryFamily(intent.category);
    return !family || family === sector;
  });
  const result = await interpret({ bot: { ...bot, intents: scopedIntents }, message, context, state, flags });
  return {
    issue: result.intentId && result.confidence >= 0.6 ? canonicalizeIssue(result.intentName) : null,
    confidence: result.confidence || 0, provider: result.provider, raw: result,
  };
}

function decisionFor(category, action, responseText, summary) {
  return {
    action, categoryId: category.id, categoryName: category.name, withinHours: true,
    needsClarification: action === "ASK_CLARIFICATION",
    shouldHandoff: action === "HANDOFF_HUMAN",
    flowResponseText: responseText, summary,
  };
}

async function knowledgeOrientation({ bot, category, issue, caseState, message, provider }) {
  const query = [issue, caseState.product, caseState.symptom, message].filter(Boolean).join(" ");
  const results = await provider.search(query, {
    botId: bot.id, category: category.name, product: caseState.product,
    limit: 5, minScore: 0.15,
  });
  if (!results.length || results.conflict) return null;
  const relevanceTerms = {
    CONEXAO: ["pareamento", "bluetooth", "conexao"],
    APP: ["mibro fit", "aplicativo"], NOTIFICACOES: ["notificacao"],
    GPS: ["gps", "gnss"], GARANTIA: ["garantia", "defeito"],
    TROCA: ["troca", "devolucao", "arrependimento"],
    PEDIDO: ["pedido", "entrega"], NOTA_FISCAL: ["nota fiscal"],
  }[issue] || [normalizeText(issue)];
  const best = results.find((item) => {
    const searchable = normalizeText(`${item.title || ""} ${item.content || ""}`);
    return relevanceTerms.some((term) => searchable.includes(normalizeText(term)));
  });
  if (!best) return null;
  if (!best.content || best.score < 0.55) return null;
  return { text: best.content.trim(), title: best.title, id: best.id };
}

async function runSectorIntake({
  bot, category, message, context = [], state = null, flags = {}, caseState: rawCaseState,
  knowledgeProvider = new KnowledgeSourceProvider(),
}) {
  const sector = categoryFamily(category);
  if (!isSectorIntakeBot(bot) || !sector || !category?.id) return null;

  let caseState = normalizeCaseState(rawCaseState);
  const messagePatch = extractPatch(message, caseState);
  if (!caseState.objective && ["COMERCIAL", "PARCERIAS"].includes(sector)) {
    messagePatch.objective = message.trim();
  }
  const classification = caseState.issue
    ? { issue: caseState.issue, confidence: 1, provider: "CASE_STATE", raw: null }
    : await classifyWithFallback({ bot, message, context, state, flags, sector });
  const issue = classification.issue;
  caseState = mergeCaseState(caseState, {
    ...messagePatch, sector, ...(issue ? { issue } : {}),
    symptom: caseState.symptom || message.trim(),
    pendingField: "none",
  });

  const interpretation = classification.raw
    ? { ...classification.raw, intentName: issue, sector, issue }
    : interpretationFor({
      issue, confidence: classification.confidence, provider: classification.provider,
      category,
    });

  if (!issue) {
    const count = caseState.intakeQuestionCount + 1;
    if (count >= 2) {
      caseState = mergeCaseState(caseState, { intakeQuestionCount: count, pendingField: "none" });
      return {
        interpretation, caseState,
        decision: decisionFor(category, "HANDOFF_HUMAN",
          "Vou encaminhar você a um atendente para entender melhor o seu caso.", "Assunto não classificado com segurança."),
      };
    }
    const question = "Claro. O que está acontecendo com seu Mibro?";
    caseState = recordQuestionAsked(mergeCaseState(caseState, {
      intakeQuestionCount: count, pendingField: "objective",
    }), question);
    return { interpretation, caseState, decision: decisionFor(category, "ASK_CLARIFICATION", question, "Aguardando descricao do problema.") };
  }

  const field = missingField(caseState, requiredFields(sector, issue));
  if (field && caseState.intakeQuestionCount < MAX_QUESTIONS) {
    const question = questionFor(field, caseState);
    caseState = recordQuestionAsked(mergeCaseState(caseState, {
      intakeQuestionCount: caseState.intakeQuestionCount + 1, pendingField: field,
    }), question);
    return {
      interpretation, caseState,
      decision: decisionFor(category, "ASK_CLARIFICATION", question, `Coletando ${field} para ${issue}.`),
    };
  }

  const orientation = await knowledgeOrientation({ bot, category, issue, caseState, message, provider: knowledgeProvider });
  const response = orientation
    ? `${orientation.text}\n\nVou encaminhar seu caso com essas informações para o setor ${category.name}.`
    : `Obrigado pelas informações. Vou encaminhar seu caso para o setor ${category.name} com o contexto coletado.`;
  caseState = mergeCaseState(caseState, {
    pendingField: "none",
    ...(orientation ? { lastResult: `Orientacao consultada: ${orientation.title}` } : {}),
  });
  return {
    interpretation,
    caseState,
    knowledgeSource: orientation,
    decision: decisionFor(category, "HANDOFF_HUMAN", response, `${issue} - coleta concluida.`),
  };
}

module.exports = {
  ASSISTANT_ID, MAX_QUESTIONS, categoryFamily, detectIssue, detectProduct,
  canonicalizeIssue, extractPatch, isSectorIntakeBot, questionFor, requiredFields, runSectorIntake,
};
