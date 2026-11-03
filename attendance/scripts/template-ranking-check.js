// Conferência SOMENTE LEITURA do ranking de templates com os registros
// existentes: para cada empresa e período, a soma das linhas por template
// e da série diária precisa bater com o total, e o total é comparado com os
// cartões de Custos Meta (que avaliam só envios com cobrança registrada).
// Imprime apenas contagens agregadas — nenhum nome de contato ou texto.
//   node scripts/template-ranking-check.js [--days=30]
require("dotenv").config({ quiet: true });
const prisma = require("../src/database/prisma");
const ranking = require("../src/services/template-performance-service");
const costs = require("../src/services/meta-cost-service");

const ADDITIVE = ["attempts", "failed", "sent", "delivered", "read", "responseEligible", "replied", "repliedByCitation", "notEvaluable"];
const master = { role: "ADMIN", id: "template-ranking-check" };

(async () => {
  const companies = await prisma.company.findMany({ select: { id: true, slug: true }, orderBy: { slug: "asc" } });
  let problems = 0;
  for (const period of ["7d", "30d", "90d"]) {
    for (const company of companies) {
      const report = await ranking.getTemplateRanking(master, { company: company.slug, period });
      const mismatches = [];
      for (const key of ADDITIVE) {
        const rows = report.templates.reduce((sum, item) => sum + item[key], 0);
        const days = report.series.reduce((sum, day) => sum + day[key], 0);
        if (rows !== report.total[key]) mismatches.push(`${key}: linhas ${rows} ≠ total ${report.total[key]}`);
        if (days !== report.total[key]) mismatches.push(`${key}: dias ${days} ≠ total ${report.total[key]}`);
      }
      const cost = await costs.getCostReport(master, { company: company.slug, from: report.period.start.toISOString(), to: report.period.end.toISOString() });
      problems += mismatches.length;
      console.log(JSON.stringify({
        period, company: company.slug, templates: report.templates.length,
        total: { sent: report.total.sent, failed: report.total.failed, delivered: report.total.delivered, read: report.total.read, eligible: report.total.responseEligible, replied: report.total.replied, rate: report.total.responseRate, contactsReplied: report.total.contactsReplied },
        attribution: report.attribution && { byCitation: report.attribution.repliedByCitation, byLatestTemplate: report.attribution.repliedByLatestTemplate, notEvaluable: report.attribution.notEvaluable, unnamed: report.attribution.unidentifiedTemplates },
        costCards: { eligible: cost.total.responseEligibleTemplates, replied: cost.total.repliedTemplates, rate: cost.total.templateResponseRate },
        sumsMatch: mismatches.length === 0, mismatches,
      }));
    }
  }
  console.log(problems ? `FALHA: ${problems} divergência(s) de soma.` : "OK: somas por template e por dia batem com os totais.");
  await prisma.$disconnect();
  process.exit(problems ? 1 : 0);
})().catch(async (error) => { console.error(error.message); await prisma.$disconnect(); process.exit(1); });
