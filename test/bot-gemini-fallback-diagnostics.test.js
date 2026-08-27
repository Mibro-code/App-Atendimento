require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const { interpret } = require("../src/services/bot-interpreter-service");

// Reproduz o relato: confiança local abaixo do threshold, Bot configurado
// para GEMINI, mas a tela mostrava só "Provider: LOCAL_FALLBACK" sem dizer
// se o Gemini sequer foi chamado nem por quê ele não foi usado.
function botFixture(overrides = {}) {
  return {
    id: "bot-gemini-diag", intents: [{
      id: "intent-pedido", name: "Acompanhar pedido", active: true, priority: 0,
      examples: [{ id: "ex-1", text: "onde esta meu pedido" }],
    }],
    ...overrides,
  };
}

function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

const geminiFlags = { externalAiFallbackEnabled: true, externalAiThreshold: 0.99, externalAiProvider: "GEMINI" };

function geminiSuccessResponse(json) {
  return { data: { candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] } };
}

test("confiança local abaixo do threshold (cenário do relato: 0.64 < 0.70) tenta a IA externa em vez de pular direto para NOT_NEEDED", async (t) => {
  await withEnv({ GEMINI_API_KEY: "chave-de-teste" }, async () => {
    t.mock.method(axios, "post", async () => geminiSuccessResponse({ intentId: "intent-pedido", confidence: 0.9, entities: {} }));
    const result = await interpret({
      bot: botFixture(), message: "algo bem diferente do exemplo cadastrado",
      flags: { externalAiFallbackEnabled: true, externalAiThreshold: 0.7, externalAiProvider: "GEMINI" },
    });
    assert.ok(result.confidence < 0.7 || result.externalAiAttempted === true, "confiança local baixa deveria acionar a tentativa externa");
    assert.equal(result.externalAiSkippedReason, null, "com confiança abaixo do threshold, não pode ser pulado como NOT_NEEDED");
  });
});

test("Gemini com chave válida: classifica com sucesso e o diagnóstico mostra GEMINI usado (nunca mascarado como LOCAL_FALLBACK)", async (t) => {
  await withEnv({ GEMINI_API_KEY: "chave-valida-de-teste" }, async () => {
    t.mock.method(axios, "post", async () => geminiSuccessResponse({ intentId: "intent-pedido", confidence: 0.93, entities: {} }));
    const result = await interpret({ bot: botFixture(), message: "mensagem ambígua qualquer", flags: geminiFlags });
    assert.equal(result.calledExternalAi, true);
    assert.equal(result.externalAiAttempted, true);
    assert.equal(result.externalAiSucceeded, true);
    assert.equal(result.externalAiProvider, "GEMINI");
    assert.equal(result.externalAiErrorCode, null);
    assert.equal(result.provider, "GEMINI");
    assert.equal(result.intentId, "intent-pedido");
  });
});

test("Gemini com chave inválida (401): erro claro e sanitizado, calledExternalAi continua true, nunca mascarado como simples LOCAL_FALLBACK", async (t) => {
  await withEnv({ GEMINI_API_KEY: "chave-invalida-de-teste" }, async () => {
    t.mock.method(axios, "post", async () => {
      throw Object.assign(new Error("Request failed"), { response: { status: 401, data: { error: { message: "API key not valid" } } } });
    });
    const result = await interpret({ bot: botFixture(), message: "mensagem ambígua qualquer", flags: geminiFlags });
    assert.equal(result.calledExternalAi, true, "a chamada real ao Gemini aconteceu — precisa continuar contando para métricas de uso");
    assert.equal(result.externalAiAttempted, true);
    assert.equal(result.externalAiSucceeded, false);
    assert.equal(result.externalAiProvider, "GEMINI");
    assert.equal(result.externalAiErrorCode, "AUTH_ERROR");
    assert.match(result.externalAiErrorMessage, /credencial/i);
    assert.doesNotMatch(result.externalAiErrorMessage, /chave-invalida-de-teste/);
    // O resultado final volta a ser o local, mas o motivo real fica visível
    // em externalAi* — nunca escondido atrás de "provider: LOCAL_FALLBACK".
    assert.equal(result.provider, "LOCAL_FALLBACK");
  });
});

test("Gemini indisponível (500): erro claro, sem vazar detalhes internos, cai para local com o motivo visível", async (t) => {
  await withEnv({ GEMINI_API_KEY: "chave-de-teste" }, async () => {
    t.mock.method(axios, "post", async () => {
      throw Object.assign(new Error("Internal error"), { response: { status: 500, data: {} } });
    });
    const result = await interpret({ bot: botFixture(), message: "mensagem ambígua qualquer", flags: geminiFlags });
    assert.equal(result.externalAiAttempted, true);
    assert.equal(result.externalAiSucceeded, false);
    assert.equal(result.externalAiErrorCode, "PROVIDER_REQUEST_FAILED");
    assert.ok(result.externalAiErrorMessage);
  });
});

test("Gemini com timeout: erro TIMEOUT claro, nunca uma exceção crua", async (t) => {
  await withEnv({ GEMINI_API_KEY: "chave-de-teste" }, async () => {
    t.mock.method(axios, "post", async () => {
      throw Object.assign(new Error("timeout of 8000ms exceeded"), { code: "ECONNABORTED" });
    });
    const result = await interpret({ bot: botFixture(), message: "mensagem ambígua qualquer", flags: geminiFlags });
    assert.equal(result.externalAiAttempted, true);
    assert.equal(result.externalAiErrorCode, "TIMEOUT");
  });
});

test("Gemini com quota excedida (429): erro QUOTA_EXCEEDED claro", async (t) => {
  await withEnv({ GEMINI_API_KEY: "chave-de-teste" }, async () => {
    t.mock.method(axios, "post", async () => {
      throw Object.assign(new Error("Too many requests"), { response: { status: 429, data: { error: { status: "RESOURCE_EXHAUSTED" } } } });
    });
    const result = await interpret({ bot: botFixture(), message: "mensagem ambígua qualquer", flags: geminiFlags });
    assert.equal(result.externalAiErrorCode, "QUOTA_EXCEEDED");
  });
});

test("fallback externo OFF: IA externa nem é tentada — diagnóstico explica 'não necessária' com o motivo DISABLED", async (t) => {
  await withEnv({ GEMINI_API_KEY: "chave-de-teste" }, async () => {
    let called = false;
    t.mock.method(axios, "post", async () => { called = true; return geminiSuccessResponse({}); });
    const result = await interpret({
      bot: botFixture(), message: "mensagem ambígua qualquer", flags: { ...geminiFlags, externalAiFallbackEnabled: false },
    });
    assert.equal(called, false, "com o fallback desligado, o Gemini nunca deveria ser chamado de verdade");
    assert.equal(result.calledExternalAi, false);
    assert.equal(result.externalAiAttempted, false);
    assert.equal(result.externalAiSkippedReason, "DISABLED");
  });
});

test("sem credencial GEMINI configurada: diagnóstico mostra NOT_CONFIGURED, nunca confunde com IA desligada ou com erro do provider", async () => {
  await withEnv({ GEMINI_API_KEY: undefined }, async () => {
    const result = await interpret({ bot: botFixture(), message: "mensagem ambígua qualquer", flags: geminiFlags });
    assert.equal(result.calledExternalAi, false);
    assert.equal(result.externalAiAttempted, false);
    assert.equal(result.externalAiSkippedReason, "NOT_CONFIGURED");
    assert.equal(result.externalAiProvider, "GEMINI");
  });
});

test("confiança local já suficiente: IA externa não é tentada (NOT_NEEDED), nunca confundida com falha", async (t) => {
  await withEnv({ GEMINI_API_KEY: "chave-de-teste" }, async () => {
    let called = false;
    t.mock.method(axios, "post", async () => { called = true; return geminiSuccessResponse({}); });
    const result = await interpret({
      bot: botFixture(), message: "onde esta meu pedido", flags: { ...geminiFlags, externalAiThreshold: 0.5 },
    });
    assert.equal(called, false);
    assert.equal(result.externalAiAttempted, false);
    assert.equal(result.externalAiSkippedReason, "NOT_NEEDED");
  });
});
