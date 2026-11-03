export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  // Evita formula injection ao abrir a exportação no Excel/LibreOffice.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
}
