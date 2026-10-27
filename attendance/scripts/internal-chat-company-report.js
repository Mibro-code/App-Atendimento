// Chat interno por empresa — relatório SOMENTE LEITURA antes/depois da migração.
//
//   node scripts/internal-chat-company-report.js
//
// Mostra apenas contagens, tipos e ids — nunca texto de mensagem.
// Regras: canais de SETOR pertencem à empresa da categoria (a migração e a
// sincronização preenchem); diretas e grupos são da equipe (entre empresas)
// e não precisam de empresa; o Geral único antigo fica como histórico
// somente leitura. Nada aqui altera o banco.
require("dotenv").config({ quiet: true });
const prisma = require("../src/database/prisma");

(async () => {
  const [byType, sectors, generals] = await Promise.all([
    prisma.internalChat.groupBy({ by: ["type", "companyId"], _count: { _all: true } }),
    prisma.internalChat.findMany({
      where: { type: "SECTOR" },
      select: { id: true, companyId: true, category: { select: { companyId: true } }, _count: { select: { messages: true } } },
    }),
    prisma.internalChat.findMany({
      where: { type: "GENERAL" },
      select: { id: true, key: true, companyId: true, archivedAt: true, _count: { select: { messages: true, members: true } } },
    }),
  ]);
  console.log("Chats por tipo e empresa:");
  for (const row of byType) console.log(`  ${row.type.padEnd(8)} ${String(row.companyId || "—").padEnd(28)} ${row._count._all}`);

  const missing = sectors.filter((chat) => !chat.companyId);
  const mismatch = sectors.filter((chat) => chat.companyId && chat.category && chat.companyId !== chat.category.companyId);
  const orphan = sectors.filter((chat) => !chat.category);
  console.log(`\nCanais de setor: ${sectors.length}`);
  console.log(`  sem empresa (preenchido na próxima sincronização): ${missing.length}`);
  console.log(`  empresa diferente da categoria: ${mismatch.length}${mismatch.length ? " → " + mismatch.map((chat) => chat.id).join(", ") : ""}`);
  console.log(`  sem categoria: ${orphan.length}`);

  console.log(`\nChats "Geral": ${generals.length} (não aparecem mais; o antigo sem empresa fica como histórico somente leitura)`);
  for (const chat of generals) console.log(`  ${chat.id} key=${chat.key} empresa=${chat.companyId || "—"} mensagens=${chat._count.messages} membros=${chat._count.members}`);
  console.log("\nSomente leitura. Nada foi alterado.");
  await prisma.$disconnect();
})().catch(async (error) => { console.error(error.message); await prisma.$disconnect(); process.exit(1); });
