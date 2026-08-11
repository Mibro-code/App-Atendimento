function teamLabel(category) {
  if (!category?.name?.trim()) return null;
  return category.name.trim();
}

function formatTeamMessage(category, content = "") {
  const label = teamLabel(category);
  if (!label) return content;
  return `*[${label}]*${content ? `\n\n${content}` : ""}`;
}

module.exports = { formatTeamMessage, teamLabel };
