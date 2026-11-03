// E2E do funil comercial (etapas, tentativas, ciclos, retornos, Inativo,
// exportação, RCA, regiões, comissão). Roda contra a aplicação em execução e
// usa o Prisma só para preparar dados e "avançar o tempo" (datas de retorno).
//
// SEGURANÇA: recusa rodar se o banco não terminar em "_perf" — nunca usar em
// desenvolvimento/produção. Requer o seed de scripts/perf/seed-perf-db.ts.
//
// Uso:
//   DATABASE_URL=postgresql://.../mibro_vendedores_perf BASE_URL=http://localhost:3100 node tests/e2e-pipeline.mjs
import { PrismaClient } from "@prisma/client";

const BASE_URL = process.env.BASE_URL || "http://localhost:3100";
const PASSWORD = process.env.PERF_PASSWORD || "perf12345";
const dbName = new URL(process.env.DATABASE_URL ?? "postgresql://x/none").pathname.slice(1);
if (!dbName.endsWith("_perf")) {
  console.error(`Recusado: banco "${dbName}" não é de teste (*_perf).`);
  process.exit(1);
}
const prisma = new PrismaClient();
const RUN = Date.now().toString(36);

let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log(`OK   - ${name}`); }
  else { failed++; console.log(`FAIL - ${name}${extra !== undefined ? " :: " + JSON.stringify(extra) : ""}`); }
}

function jar() {
  const cookies = new Map();
  return {
    apply(headers) { if (cookies.size) headers.set("cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; ")); },
    capture(res) {
      for (const sc of res.headers.getSetCookie?.() ?? []) {
        const [pair] = sc.split(";"); const i = pair.indexOf("=");
        cookies.set(pair.slice(0, i), pair.slice(i + 1));
      }
    },
  };
}
async function req(j, path, opts = {}) {
  const headers = new Headers(opts.headers || {}); j.apply(headers);
  if (opts.json !== undefined) { headers.set("content-type", "application/json"); opts = { ...opts, body: JSON.stringify(opts.json) }; }
  const res = await fetch(BASE_URL + path, { ...opts, headers, redirect: "manual" }); j.capture(res); return res;
}
async function login(email) {
  const j = jar();
  const { csrfToken } = await (await req(j, "/api/auth/csrf")).json();
  await req(j, "/api/auth/callback/credentials", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, password: PASSWORD, csrfToken, callbackUrl: BASE_URL + "/dashboard", json: "true" }),
  });
  return j;
}
const json = async (res) => res.json().catch(() => ({}));
const stage = (j, id, body) => req(j, `/api/customers/${id}/stage`, { method: "POST", json: body });
const contact = (j, id, channel = "WHATSAPP", note) => req(j, `/api/customers/${id}/contact-attempts`, { method: "POST", json: { channel, note } });
const cards = async (j, column, params = {}) => json(await req(j, `/api/pipeline/cards?${new URLSearchParams({ column, withCount: "1", ...params })}`));
const reload = (id) => prisma.customer.findUnique({ where: { id } });
// Abre a tela (aplica retornos vencidos). Lê o corpo inteiro: a página faz
// streaming (loading.tsx), então a renderização só termina com o corpo.
const openClientes = async (j) => (await req(j, "/clientes")).text();

async function newCustomer(sellerId, extra = {}) {
  return prisma.customer.create({ data: { contactName: `E2E ${RUN} ${Math.random().toString(36).slice(2, 7)}`, tradeName: `E2E Funil ${RUN} ${Math.random().toString(36).slice(2, 7)}`, sellerId, ...extra } });
}

async function main() {
  console.log(`Testando contra ${BASE_URL} (banco ${dbName})\n`);
  const [admin, sup, seller, seller2, rep, rep2] = await Promise.all(
    ["admin@perf.local", "supervisor1@perf.local", "vendedor1@perf.local", "vendedor2@perf.local", "vendedor4@perf.local", "vendedor8@perf.local"]
      .map((email) => prisma.user.findUnique({ where: { email } }))
  );
  const [adminJ, supJ, sellerJ, seller2J, repJ] = await Promise.all([admin, sup, seller, seller2, rep].map((u) => login(u.email)));
  const customersBefore = await prisma.customer.count();

  // ---------------------------------------------------------------- Inativo
  console.log("— Bug: Inativo continua ativo");
  const c1 = await newCustomer(seller.id);
  await prisma.customerActivity.create({ data: { customerId: c1.id, sellerId: seller.id, type: "ANOTACAO", description: "atividade anterior" } });
  await prisma.followUp.create({ data: { customerId: c1.id, sellerId: seller.id, dueAt: new Date(Date.now() + 86400000), source: "MANUAL" } });
  let r = await stage(sellerJ, c1.id, { action: "MOVE", to: "EM_ATENDIMENTO" });
  ok("1. cliente vai para Em atendimento", r.status === 200 && (await reload(c1.id)).pipelineStage === "EM_ATENDIMENTO", r.status);
  const q = { q: c1.tradeName };
  ok("1b. aparece na coluna Em atendimento", (await cards(sellerJ, "EM_ATENDIMENTO", q)).count === 1);
  r = await stage(sellerJ, c1.id, { action: "MOVE", to: "INATIVO" });
  ok("motivo é obrigatório para Inativo", r.status === 400, r.status);
  r = await stage(sellerJ, c1.id, { action: "MOVE", to: "INATIVO", reason: "Sem interesse" });
  const afterInactive = await reload(c1.id);
  ok("2/3. vendedor marca Inativo e o backend salva INATIVO (status e etapa)", r.status === 200 && afterInactive.status === "INATIVO" && afterInactive.pipelineStage === "INATIVO", afterInactive);
  const em = await cards(sellerJ, "EM_ATENDIMENTO", q);
  const ina = await cards(sellerJ, "INATIVO", q);
  ok("4. some de Em atendimento", em.count === 0 && em.cards.length === 0);
  ok("5. aparece em Inativos", ina.count === 1 && ina.cards[0]?.stageReason === "Sem interesse");
  ok("6. contadores atualizam (0 em atendimento / 1 inativo)", em.count === 0 && ina.count === 1);
  const again = await cards(sellerJ, "INATIVO", q);
  ok("7. refresh mantém correto", again.count === 1 && (await reload(c1.id)).status === "INATIVO");
  const activeSearch = await (await req(sellerJ, `/clientes?${new URLSearchParams({ q: c1.tradeName, status: "CLIENTE_ATIVO" })}`)).text();
  const stageSearch = await (await req(sellerJ, `/clientes?${new URLSearchParams({ q: c1.tradeName, stage: "EM_ATENDIMENTO" })}`)).text();
  ok("8. busca não o trata como ativo", activeSearch.includes("Nenhum cliente encontrado") && stageSearch.includes("Nenhum cliente encontrado"));
  const hist = await prisma.customerStatusHistory.findMany({ where: { customerId: c1.id } });
  ok("histórico mantido (etapa + status, com RCA)", hist.some((h) => h.field === "PIPELINE_STAGE" && h.newValue === "INATIVO" && h.changedByRca === seller.rca && h.reason === "Sem interesse") && hist.some((h) => h.field === "STATUS" && h.newValue === "INATIVO"));
  ok("responsável mantido e atividades preservadas", afterInactive.sellerId === seller.id && (await prisma.customerActivity.count({ where: { customerId: c1.id } })) === 1);
  ok("sai das filas ativas (follow-ups pendentes encerrados)", (await prisma.followUp.count({ where: { customerId: c1.id, status: { in: ["PENDENTE", "ADIADO"] } } })) === 0);
  ok("inativos por atendente: outro vendedor não vê", (await cards(seller2J, "INATIVO", q)).count === 0);
  ok("supervisor vê inativo da equipe; filtro 'meus inativos' com vendedor", (await cards(supJ, "INATIVO", { ...q, sellerId: seller.id })).count === 1);
  r = await stage(seller2J, c1.id, { action: "MOVE", to: "NOVO" });
  ok("vendedor de fora não altera cliente de outro (403)", r.status === 403, r.status);
  r = await req(sellerJ, `/api/customers/${c1.id}/status`, { method: "POST", json: { status: "CONTATO_REALIZADO" } });
  ok("reativar pelo status legado tira de Inativos", r.status === 200 && (await reload(c1.id)).pipelineStage === "EM_ATENDIMENTO");
  r = await req(sellerJ, `/api/customers/${c1.id}/status`, { method: "POST", json: { status: "INATIVO" } });
  ok("status INATIVO pelo editor legado também move para Inativos", r.status === 200 && (await reload(c1.id)).pipelineStage === "INATIVO");

  // ------------------------------------------------------------ Exportação
  console.log("\n— Exportação (RBAC)");
  ok("vendedor não exporta (403)", (await req(sellerJ, "/api/customers/export")).status === 403);
  ok("representante não exporta (403)", (await req(repJ, "/api/customers/export")).status === 403);
  const supExport = await req(supJ, "/api/customers/export");
  ok("supervisor exporta", supExport.status === 200 && (supExport.headers.get("content-type") ?? "").includes("text/csv"));
  ok("admin exporta", (await req(adminJ, "/api/customers/export?state=MG")).status === 200);
  const sellerPage = await (await req(sellerJ, "/clientes")).text();
  ok("botão de exportar não aparece para vendedor", !sellerPage.includes("Exportar clientes") && !sellerPage.includes("Exportar meus clientes"));
  ok("botão de exportar aparece para supervisor", (await (await req(supJ, "/clientes?stage=VENDIDO")).text()).includes("Exportar clientes"));

  // ------------------------------------------------------------ Tentativas
  console.log("\n— Tentativas de contato");
  const c2 = await newCustomer(seller.id);
  r = await contact(sellerJ, c2.id, "WHATSAPP", "primeira");
  let body = await json(r);
  ok("tentativa 1 → ★☆☆ e Novos → Em atendimento", r.status === 201 && body.attempts === 1 && body.stage === "EM_ATENDIMENTO", body);
  body = await json(await contact(sellerJ, c2.id, "TELEFONE"));
  ok("tentativa 2 → ★★☆", body.attempts === 2);
  body = await json(await contact(sellerJ, c2.id, "EMAIL"));
  ok("tentativa 3 → ★★★", body.attempts === 3 && body.card.attempts === 3);
  const attempts = await prisma.customerActivity.findMany({ where: { customerId: c2.id, isContactAttempt: true }, orderBy: { createdAt: "asc" } });
  ok("registra usuário, data, canal, etapa, ciclo e observação", attempts.length === 3 && attempts.every((a) => a.sellerId === seller.id && a.commercialCycle === 1) && attempts[0].type === "WHATSAPP" && attempts[0].description === "primeira" && attempts[0].pipelineStage === "NOVO" && attempts[1].pipelineStage === "EM_ATENDIMENTO");
  ok("filtro por nº de tentativas (3)", (await cards(sellerJ, "EM_ATENDIMENTO", { q: c2.tradeName, attempts: "3" })).count === 1 && (await cards(sellerJ, "EM_ATENDIMENTO", { q: c2.tradeName, attempts: "1" })).count === 0);
  ok("não move automaticamente após 3 tentativas", (await reload(c2.id)).pipelineStage === "EM_ATENDIMENTO");

  console.log("\n— Após 3 tentativas");
  r = await stage(sellerJ, c2.id, { action: "MOVE", to: "RECICLAGEM", reason: "3 tentativas sem resposta", returnOption: "7", returnTo: "EM_ATENDIMENTO" });
  let c = await reload(c2.id);
  ok("3 tentativas → Reciclagem com motivo e data", r.status === 200 && c.pipelineStage === "RECICLAGEM" && c.stageReturnAt > new Date() && c.stageReturnTo === "EM_ATENDIMENTO");
  ok("reciclagem sai das filas ativas", (await cards(sellerJ, "EM_ATENDIMENTO", { q: c2.tradeName })).count === 0);
  await prisma.customer.update({ where: { id: c2.id }, data: { stageReturnAt: new Date(Date.now() - 60_000) } });
  await openClientes(sellerJ);
  c = await reload(c2.id);
  ok("reciclagem com data: na data volta para Em atendimento", c.pipelineStage === "EM_ATENDIMENTO" && c.stageReturnAt === null);
  ok("novo ciclo: estrelas reiniciam, histórico antigo separado", c.commercialCycle === 2 && c.cycleContactAttempts === 0 && (await prisma.customerActivity.count({ where: { customerId: c2.id, isContactAttempt: true, commercialCycle: 1 } })) === 3);

  const c3 = await newCustomer(seller.id);
  for (let i = 0; i < 3; i++) await contact(sellerJ, c3.id);
  r = await stage(sellerJ, c3.id, { action: "MOVE", to: "INATIVO", reason: "Sem retorno" });
  ok("3 tentativas → Inativo", r.status === 200 && (await reload(c3.id)).pipelineStage === "INATIVO");
  ok("inativo não aceita novo contato sem reativar", (await contact(sellerJ, c3.id)).status === 409);

  const c4 = await newCustomer(seller.id);
  for (let i = 0; i < 3; i++) await contact(sellerJ, c4.id);
  r = await stage(sellerJ, c4.id, { action: "SCHEDULE_RETURN", returnOption: "3", returnTo: "NOVO" });
  c = await reload(c4.id);
  ok("3 tentativas → retorno futuro para Novos (data salva, etapa mantida)", r.status === 200 && c.pipelineStage === "EM_ATENDIMENTO" && c.stageReturnTo === "NOVO" && c.stageReturnAt > new Date());
  r = await stage(sellerJ, c4.id, { action: "SCHEDULE_RETURN", returnOption: "custom", customDate: "2020-01-01" });
  ok("data personalizada no passado é recusada", r.status === 400);
  await prisma.customer.update({ where: { id: c4.id }, data: { stageReturnAt: new Date(Date.now() - 60_000) } });
  await openClientes(sellerJ);
  c = await reload(c4.id);
  ok("quando chega a data volta para Novos (responsável e origem preservados)", c.pipelineStage === "NOVO" && c.sellerId === seller.id && c.commercialCycle === 2);

  // ------------------------------------------------------------ Follow-up
  console.log("\n— Follow-up");
  const c5 = await newCustomer(seller.id);
  await prisma.customer.update({ where: { id: c5.id }, data: { lastSaleAt: new Date() } });
  await contact(sellerJ, c5.id);
  r = await stage(sellerJ, c5.id, { action: "MOVE", to: "FOLLOW_UP", followUpOption: "1", followUpNote: "ligar de novo" });
  ok("mover para Follow-up cria o próximo contato", r.status === 200 && (await prisma.followUp.count({ where: { customerId: c5.id, source: "MANUAL", status: "PENDENTE" } })) === 1);
  ok("filtro Follow-up: amanhã", (await cards(sellerJ, "FOLLOW_UP", { q: c5.tradeName, followUp: "TOMORROW" })).count === 1);
  ok("filtro Follow-up: vencido (não)", (await cards(sellerJ, "FOLLOW_UP", { q: c5.tradeName, followUp: "OVERDUE" })).count === 0);
  ok("filtro Follow-up: 1 tentativa", (await cards(sellerJ, "FOLLOW_UP", { q: c5.tradeName, attempts: "1" })).count === 1);
  const c5b = await newCustomer(seller.id);
  await prisma.customer.update({ where: { id: c5b.id }, data: { lastSaleAt: new Date() } });
  await stage(sellerJ, c5b.id, { action: "MOVE", to: "FOLLOW_UP" });
  ok("filtro Follow-up: sem data", (await cards(sellerJ, "FOLLOW_UP", { q: c5b.tradeName, followUp: "NONE" })).count === 1);

  // ------------------------------------------------------------ Cotação
  console.log("\n— Cotação");
  const c6 = await newCustomer(seller.id);
  const quote = await prisma.quote.create({ data: { customerId: c6.id, sellerId: seller.id, status: "ENVIADA", totalValueCents: 1_250_000 } });
  r = await stage(sellerJ, c6.id, { action: "MOVE", to: "COTACAO" });
  body = await json(r);
  ok("Cotação reutiliza a cotação existente (valor no card)", r.status === 200 && body.card.stage === "COTACAO" && body.card.quote?.id === quote.id && body.card.quote.valueCents === 1_250_000);
  ok("sem cotação duplicada", (await prisma.quote.count({ where: { customerId: c6.id } })) === 1);

  // ------------------------------------------------------ Representantes
  console.log("\n— Representante: tipo, regiões, RCA");
  r = await req(supJ, `/api/users/${rep.id}/representative`, { method: "PUT", json: { representativeType: "VAREJO", regions: [
    { state: "SP", city: "São Paulo" }, { state: "SP", city: "Campinas" }, { state: "SP", city: "Santos" },
    { state: "MG", city: "Belo Horizonte" }, { state: "MG", city: "Uberlândia" }, { state: "SP", city: "campinas" },
  ] } });
  body = await json(r);
  ok("múltiplas cidades e múltiplos estados (sem duplicar)", r.status === 200 && body.regions.length === 5 && new Set(body.regions.map((x) => x.state)).size === 2, body);
  ok("supervisor não configura representante de outra equipe", (await req(supJ, `/api/users/${(await prisma.user.findUnique({ where: { email: "vendedor14@perf.local" } })).id}/representative`, { method: "PUT", json: { representativeType: "VAREJO", regions: [] } })).status === 403);
  ok("representante segue com role REPRESENTANTE (tipo é subtipo)", (await prisma.user.findUnique({ where: { id: rep.id } })).role === "REPRESENTANTE");
  await req(supJ, `/api/users/${rep2.id}/representative`, { method: "PUT", json: { representativeType: "ATACADO", regions: [{ state: "PR" }] } });
  const regionSearch = await json(await req(supJ, "/api/users/search?state=SP&city=Campinas&roles=REPRESENTANTE"));
  ok("região: quem atende Campinas/SP aparece primeiro", regionSearch.users?.[0]?.id === rep.id && regionSearch.users[0].regionScore === 2, regionSearch.users?.slice(0, 2));
  const rcaSearch = await json(await req(supJ, `/api/users/search?q=${seller.rca}`));
  ok(`busca por RCA "${seller.rca}" encontra ${seller.name}`, rcaSearch.users?.[0]?.id === seller.id);
  const nameSearch = await json(await req(supJ, `/api/users/search?q=${encodeURIComponent("Vendedor Perf 1")}`));
  ok("busca por nome", nameSearch.users?.some((u) => u.id === seller.id));
  ok("busca respeita RBAC (supervisor não vê outra equipe)", !(await json(await req(supJ, "/api/users/search?q=Perf%2014"))).users?.some((u) => u.name.endsWith(" 14")));
  ok("busca não expõe id técnico como RCA", rcaSearch.users.every((u) => !u.rca || /^\d{3,6}$/.test(u.rca)));
  r = await req(adminJ, `/api/users/${seller2.id}`, { method: "PATCH", json: { rca: seller.rca } });
  ok("RCA único (duplicado → 409)", r.status === 409, r.status);
  r = await req(adminJ, `/api/users/${seller2.id}`, { method: "PATCH", json: { rca: "abc" } });
  ok("RCA inválido → 400", r.status === 400);
  ok("todos os usuários têm RCA distinto", (await prisma.user.groupBy({ by: ["rca"], _count: { _all: true }, having: { rca: { _count: { gt: 1 } } } })).length === 0);

  // ------------------------------------------------ Vendido + comissão
  console.log("\n— Vendido, comissão e recompra");
  const c7 = await newCustomer(rep.id);
  r = await stage(repJ, c7.id, { action: "MOVE", to: "VENDIDO" });
  ok("Vendido exige pedido e valor", r.status === 400);
  r = await stage(repJ, c7.id, { action: "MOVE", to: "VENDIDO", sale: { valueCents: 1_250_000, orderReference: "456" } });
  body = await json(r);
  const sale = await prisma.sale.findFirst({ where: { customerId: c7.id } });
  ok("Vendido registra pedido e valor", r.status === 200 && body.card.stage === "VENDIDO" && sale?.valueCents === 1_250_000 && sale.stage === "PAGAMENTO_CONFIRMADO");
  ok("comissão padrão Varejo 5% (origem DEFAULT)", sale.commissionRateBps === 500 && sale.commissionCents === 62_500 && sale.commissionSource === "DEFAULT", sale);
  r = await req(repJ, `/api/sales/${sale.id}/commission`, { method: "PATCH", json: { percent: 7 } });
  ok("representante não altera a própria comissão", r.status === 403);
  r = await req(supJ, `/api/sales/${sale.id}/commission`, { method: "PATCH", json: { percent: 7 } });
  const custom = await prisma.sale.findUnique({ where: { id: sale.id } });
  ok("comissão específica por pedido (7%) tem prioridade", r.status === 200 && custom.commissionRateBps === 700 && custom.commissionCents === 87_500 && custom.commissionSource === "CUSTOM_ORDER" && custom.commissionSetById === sup.id);
  const repSales = await (await req(repJ, "/vendas")).text();
  ok("representante vê a própria comissão", repSales.includes("7%") && repSales.includes("específica do pedido"));
  const c8 = await newCustomer(rep2.id);
  const rep2J = await login(rep2.email);
  await stage(rep2J, c8.id, { action: "MOVE", to: "VENDIDO", sale: { valueCents: 500_000, orderReference: "789" } });
  const atacadoSale = await prisma.sale.findFirst({ where: { customerId: c8.id } });
  ok("Atacado sem percentual: comissão em branco (nada inventado)", atacadoSale.commissionRateBps === null && atacadoSale.commissionCents === null);
  const repSalesOther = await (await req(repJ, "/vendas")).text();
  ok("representante não vê comissão de outro representante", !repSalesOther.includes("789"));

  await prisma.customer.update({ where: { id: c7.id }, data: { pipelineStageChangedAt: new Date(Date.now() - 31 * 86_400_000) } });
  await openClientes(repJ);
  c = await reload(c7.id);
  const recompra = await cards(repJ, "FOLLOW_UP", { q: c7.tradeName });
  ok("após 30 dias entra no Follow-up de recompra (novo ciclo)", c.pipelineStage === "FOLLOW_UP" && c.commercialCycle === 2);
  ok("recompra: badge e filtro", recompra.cards[0]?.repurchase === true && (await cards(repJ, "FOLLOW_UP", { q: c7.tradeName, repurchase: "1" })).count === 1);
  ok("venda anterior preservada (pedido, valor, comissão, responsável)", (await prisma.sale.findUnique({ where: { id: sale.id } })).commissionRateBps === 700 && c.sellerId === rep.id && c.lastSaleAt !== null);

  // ------------------------------------------------------------ Endereço
  console.log("\n— Endereço");
  const withAddr = await newCustomer(seller.id, { addressStreet: "Rua A", addressNumber: "10", addressComplement: "Sala 2", city: "Campinas", state: "SP" });
  const withoutAddr = await newCustomer(seller.id, { city: "Campinas", state: "SP" });
  ok("filtro com endereço", (await cards(sellerJ, "NOVO", { q: withAddr.tradeName, address: "com" })).count === 1 && (await cards(sellerJ, "NOVO", { q: withAddr.tradeName, address: "sem" })).count === 0);
  ok("filtro sem endereço", (await cards(sellerJ, "NOVO", { q: withoutAddr.tradeName, address: "sem" })).count === 1 && (await cards(sellerJ, "NOVO", { q: withoutAddr.tradeName, address: "com" })).count === 0);
  ok("filtro por cidade/UF", (await cards(sellerJ, "NOVO", { q: withAddr.tradeName, city: "Campinas", state: "SP" })).count === 1);

  // -------------------------------------------------------- Integridade
  const created = 11;
  ok("nenhum cliente apagado ou duplicado", (await prisma.customer.count()) === customersBefore + created, { before: customersBefore, now: await prisma.customer.count() });

  console.log(`\n${passed} passaram, ${failed} falharam.`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
