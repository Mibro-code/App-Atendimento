// Arquitetura-base para futuras fontes de conhecimento (FAQ, produtos,
// manuais, garantia, políticas, Shopify, Olist, documentação, rastreamento).
// Nesta fase não há RAG nem banco vetorial: apenas o contrato que uma futura
// implementação deve seguir, para que o interpretador possa, no futuro,
// consultar contexto adicional sem acoplamento a uma fonte específica.

const knowledgeDomains = Object.freeze([
  "FAQ", "PRODUCTS", "MANUALS", "WARRANTY", "POLICIES", "SHOPIFY", "OLIST", "DOCUMENTATION", "TRACKING",
]);

class KnowledgeProvider {
  // Deve retornar uma lista de trechos relevantes: [{ domain, title, content, score }].
  async search(_query, _domains = knowledgeDomains) {
    throw new Error("Nenhum KnowledgeProvider implementado nesta fase.");
  }
}

module.exports = { KnowledgeProvider, knowledgeDomains };
