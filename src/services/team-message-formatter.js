function teamLabel(category) {
  if (!category?.name?.trim()) return null;
  const name = category.name.trim();
  const parentName = category.parent?.name?.trim();
  return parentName ? `${parentName}: ${name}` : name;
}

function formatTeamMessage(category, content = "") {
  const label = teamLabel(category);
  if (!label) return content;
  return `*[${label}]*${content ? `\n\n${content}` : ""}`;
}

module.exports = { formatTeamMessage, teamLabel };
