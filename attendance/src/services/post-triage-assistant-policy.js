// Only the Mibro assistant is excluded from Atacado. Reception/triage bots
// and the other companies/categories retain their existing behavior.
function skipPostTriageAssistant(bot, category) {
  return bot?.id === "mibro-assistant-observer" && category?.code === "ATACADO";
}

module.exports = { skipPostTriageAssistant };
