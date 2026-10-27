const TECHNICAL_ASSISTANCE_MESSAGE = `Para que possamos dar continuidade ao seu atendimento, pedimos, por gentileza, que nos envie os seguintes dados:

1. Serial Number (SN) — localizado na caixa ou no próprio relógio.
Exemplo: AW012/12345678.
2. Dados do estabelecimento ou local onde o produto foi adquirido.
3. Nota Fiscal (NF/DANFE) referente ao produto adquirido.

Caso queira realizar uma consulta por conta própria, você também pode verificar a homologação do produto diretamente em nosso site. Basta acessar a página abaixo e informar o Serial Number (SN) registrado na caixa ou no próprio relógio:
https://mibrobrasil.com.br/pages/check-sn

Dessa forma, será possível verificar se o produto está devidamente homologado.`;

// Add a sector-specific branch to existing published graphs without replacing
// their other nodes. Stable keys preserve ongoing executions and retries.
function withTechnicalAssistanceIntake(graph, bot) {
  if (bot?.id !== "mibro-assistant-observer") return graph;
  if (graph.nodes.some(node => node.key === "tech_intake_category")) return graph;
  const start = graph.nodes.find(node => node.type === "start" && node.config?.trigger === "AFTER_TRIAGE");
  const next = start && graph.edges.find(edge => edge.source === start.key && edge.sourceHandle === "next");
  if (!next) return graph;
  const nodes = [
    { key: "tech_intake_category", type: "condition", name: "Assistência Técnica?", config: {
      rules: [{ left: "conversation.categoryCode", operator: "==", right: "1_ASSISTENCIA_TECNICA" }],
    } },
    { key: "tech_intake_documents", type: "message", name: "SN, compra e nota fiscal", config: { source: "TEXT", text: TECHNICAL_ASSISTANCE_MESSAGE } },
    { key: "tech_intake_handoff", type: "human_handoff", name: "Aguardar documentos com a equipe", config: {
      message: "", reason: "Assistência Técnica: solicitados SN, local de compra e NF/DANFE. Aguardando análise da equipe.",
    } },
  ];
  const edges = [
    ["tech_intake_category", "true", "tech_intake_documents"],
    ["tech_intake_category", "false", next.target],
    ["tech_intake_documents", "next", "tech_intake_handoff"],
  ].map(([source, sourceHandle, target]) => ({ id: `${source}:${sourceHandle}:${target}`, source, sourceHandle, target }));
  return { ...graph, nodes: [...graph.nodes, ...nodes], edges: [
    ...graph.edges.map(edge => edge === next ? { ...edge, target: "tech_intake_category" } : edge), ...edges,
  ] };
}

module.exports = { TECHNICAL_ASSISTANCE_MESSAGE, withTechnicalAssistanceIntake };
