function teamLabel(category) {
  if (!category?.name?.trim()) return null;
  if (category.code === "COMERCIAL") return `Equipe ${category.name.trim().toUpperCase()}`;
  return `Equipe de ${category.name.trim()}`;
}

function formatTeamMessage(category, content = "") {
  const label = teamLabel(category);
  if (!label) return content;
  return `*${label}*${content ? `\n\n${content}` : ""}`;
}

module.exports = { formatTeamMessage, teamLabel };
