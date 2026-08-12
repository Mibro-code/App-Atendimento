const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const categories = [
  ["ATENDIMENTO", "Atendimento", "#0f766e"],
  ["SUPORTE", "Suporte", "#2563eb"],
  ["COMERCIAL", "Comercial", "#059669"],
  ["PARCERIAS", "Parcerias", "#7c3aed"],
  ["ATACADO", "Atacado", "#7c3aed"],
  ["GARANTIA", "Garantia", "#dc2626"], ["PEDIDOS", "Pedidos", "#d97706"],
  ["TROCAS_DEVOLUCOES", "Trocas e devoluções", "#db2777"], ["OUTROS", "Outros", "#6b7280"],
];
async function main() {
  for (const [index, [code, name, color]] of categories.entries()) {
    const data = { code, name, color, displayOrder: (index + 1) * 10 };
    await prisma.category.upsert({ where: { code }, update: data, create: data });
  }
}
main().then(() => console.log("Categorias iniciais cadastradas."))
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
