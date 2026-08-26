// Item 3/4: separa "entender a intenção" (GlobalIntent/BotIntent) de "saber
// a resposta" (KnowledgeSource). Sem RAG/banco vetorial nesta fase — busca
// estruturada por texto/tags/tipo/intenção/produto/categoria, montada para
// permitir semântica futura (embeddings/vetor) sem quebrar a assinatura
// pública de search(). Regras de segurança: nunca retorna conteúdo
// desativado ou expirado; nunca inventa nada além do que está no banco.
const prisma = require("../../database/prisma");
const { normalizeText } = require("../bot-simulator-service");
const { isActiveNow } = require("../bot-knowledge-source-service");

const knowledgeDomains = Object.freeze([
  "FAQ", "MANUAL", "PRODUCT", "POLICY", "WARRANTY", "PROCEDURE", "GENERAL", "OTHER",
]);

class KnowledgeProvider {
  // Deve retornar uma lista de trechos relevantes: [{ domain, title, content, score, source }].
  // eslint-disable-next-line no-unused-vars
  async search(_query, _domains = knowledgeDomains) {
    throw new Error("Nenhum KnowledgeProvider implementado nesta fase.");
  }
}

function scoreText(queryTokens, text) {
  if (!text) return 0;
  const tokens = new Set(normalizeText(text).split(/\s+/).filter(Boolean));
  if (!tokens.size || !queryTokens.length) return 0;
  const hits = queryTokens.filter((token) => tokens.has(token)).length;
  return hits / queryTokens.length;
}

// Implementação real (sem semântica) apoiada no modelo KnowledgeSource.
// Nunca retorna itens inativos/expirados (item 3: "conteúdo desativado ou
// expirado nunca é retornado/usado"). `filters` permite restringir por
// domínio estruturado (Bot, GlobalIntent/BotIntent, categoria, produto,
// tags) além do texto livre da consulta.
class KnowledgeSourceProvider extends KnowledgeProvider {
  constructor(client = prisma) {
    super();
    this.client = client;
  }

  async search(query, {
    domains = knowledgeDomains, botId = null, intentId = null, globalIntentId = null,
    category = null, product = null, tags = [], limit = 5, minScore = 0.15,
  } = {}) {
    // Cada filtro estruturado é opcional: quando informado, aceita tanto o
    // registro específico daquele escopo (ex.: desta intenção) quanto um
    // registro genérico (sem esse campo preenchido) — conhecimento geral
    // continua aparecendo mesmo filtrando por Bot/intenção/categoria/produto.
    const andClauses = [{ active: true }];
    if (domains && domains.length && domains.length < knowledgeDomains.length) andClauses.push({ type: { in: domains } });
    if (botId) {
      andClauses.push({
        OR: [
          { botAccesses: { some: { botId } } },
          { botId },
          { AND: [{ botId: null }, { botAccesses: { none: {} } }] },
        ],
      });
    }
    if (intentId) andClauses.push({ OR: [{ intentId }, { intentId: null }] });
    if (globalIntentId) andClauses.push({ OR: [{ globalIntentId }, { globalIntentId: null }] });
    if (category) andClauses.push({ OR: [{ category }, { category: null }] });
    if (product) andClauses.push({ OR: [{ product }, { product: null }] });
    if (tags && tags.length) andClauses.push({ tags: { hasSome: tags } });
    const where = { AND: andClauses };

    const now = new Date();
    const rows = await this.client.knowledgeSource.findMany({ where, take: 200 });
    const active = rows.filter((row) => isActiveNow(row, now));

    const queryTokens = normalizeText(query || "").split(/\s+/).filter(Boolean);
    const scored = active.map((row) => {
      const titleScore = scoreText(queryTokens, row.title) * 1.5;
      const contentScore = scoreText(queryTokens, row.content || "");
      const tagScore = (row.tags || []).some((tag) => queryTokens.includes(normalizeText(tag))) ? 0.5 : 0;
      const score = queryTokens.length ? Math.min(1, (titleScore + contentScore + tagScore) / 2) : 0.3;
      return {
        id: row.id,
        domain: row.type,
        title: row.title,
        content: row.content,
        score,
        source: row.source,
        category: row.category,
        product: row.product,
        globalIntentId: row.globalIntentId,
        intentId: row.intentId,
      };
    });

    return scored
      .filter((item) => item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

module.exports = { KnowledgeProvider, KnowledgeSourceProvider, knowledgeDomains };
