const PATTERNS = Object.freeze([
  { id: "wholesale", label: "Quero comprar no atacado" },
  { id: "information", label: "Olá! Posso ter mais informações sobre isso?" },
]);
const INFORMATION_REPLY = "Olá! Você pode conferir nossos produtos de forma mais clara e conhecer as opções disponíveis em nosso site: https://sincrofit.com.br/";
function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
const normalized = new Map(PATTERNS.map(p => [normalize(p.label), p.id]));
function entryPattern(text) { return normalized.get(normalize(text)) || null; }

// New triage sessions only; state keeps this value across outside-hours waits.
function seedEntryPattern(seed, bot, input) {
  if (bot?.id === "sincrofit-system-triage-20261022" && input?.type === "START") {
    seed.flow.sincrofitEntryPattern = entryPattern(input.text) || "";
  }
  return seed;
}
function withSincrofitEntryReply(graph, bot) {
  if (bot?.id !== "sincrofit-system-triage-20261022" || graph.nodes.some(n => n.key === "sincro_ad_entry")) return graph;
  const start = graph.nodes.find(n => n.type === "start");
  const next = start && graph.edges.find(e => e.source === start.key && e.sourceHandle === "next");
  if (!next) return graph;
  // Branch before the original greeting so the information entry gets just
  // the requested reply; every other entry retains the original greeting.
  const greeting = start.config?.initialMessage || "";
  const nodes = [
    { key: "sincro_ad_entry", type: "condition", name: "Mensagem de informações?", config: { rules: [{ left: "flow.sincrofitEntryPattern", operator: "==", right: "information" }] } },
    { key: "sincro_ad_reply", type: "message", name: "Produtos no site", config: { source: "TEXT", text: INFORMATION_REPLY } },
    { key: "sincro_ad_handoff", type: "human_handoff", name: "Continuar com a equipe", config: { message: "", reason: "Entrada pela mensagem-padrão de informações; site Sincrofit informado." } },
    { key: "sincro_original_greeting", type: "message", name: "Recepção original", config: { source: "TEXT", text: greeting } },
  ];
  const links = [["sincro_ad_entry", "true", "sincro_ad_reply"], ["sincro_ad_reply", "next", "sincro_ad_handoff"],
    ["sincro_ad_entry", "false", greeting.trim() ? "sincro_original_greeting" : next.target],
    ...(greeting.trim() ? [["sincro_original_greeting", "next", next.target]] : [])];
  // Avoid an unreachable/empty greeting node when the original has none.
  return { ...graph, nodes: [...graph.nodes.map(n => n === start ? { ...n, config: { ...n.config, initialMessage: "" } } : n), ...nodes.filter(n => n.key !== "sincro_original_greeting" || greeting.trim())],
    edges: [...graph.edges.map(e => e === next ? { ...e, target: "sincro_ad_entry" } : e), ...links.map(([source, sourceHandle, target]) => ({ id: `${source}:${sourceHandle}:${target}`, source, sourceHandle, target }))] };
}
module.exports = { PATTERNS, INFORMATION_REPLY, entryPattern, seedEntryPattern, withSincrofitEntryReply };
