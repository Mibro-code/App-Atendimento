function teamLabel(category) {
  if (!category?.name?.trim()) return null;
  const name = category.name.trim();
  const parentName = category.parent?.name?.trim();
  return parentName ? `${parentName}: ${name}` : name;
}

function formatTeamMessage(category, content = "") {
  if (!category?.name?.trim()) return content;
  const name = category.name.trim();
  const parentName = category.parent?.name?.trim();
  const label = parentName ? `[*${parentName}*: ${name}]` : `[*${name}*]`;
  return `${label}${content ? `\n\n${content}` : ""}`;
}

module.exports = { formatTeamMessage, teamLabel };
