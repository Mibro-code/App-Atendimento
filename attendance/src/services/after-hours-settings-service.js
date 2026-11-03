// Atendimento fora do expediente — configurações e feriados.
// Mesmo padrão de conversation-settings-service.js: linha "global" é o
// padrão; uma empresa ganha linha própria ("company:<id>", cópia da global)
// na primeira edição e pode voltar a usar a global.
// Permissões (sempre no backend): Master edita tudo; Supervisor visualiza
// as próprias empresas e só edita a configuração/feriados da empresa com o
// flag canManageAfterHours; Atendente não acessa esta área.
const prisma = require("../database/prisma");
const authorization = require("./authorization-service");
const audit = require("./audit-service");
const companyService = require("./company-service");
const calendar = require("./business-hours-service");

const GLOBAL_ID = "global";
const GLOBAL_SCOPE = "GLOBAL";
const HOLIDAY_SCOPES = ["NACIONAL", "ESTADUAL", "MUNICIPAL", "EMPRESA", "EXCECAO"];
const CACHE_TTL_MS = 5000;
let cache = new Map();
let cacheExpiresAt = 0;

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function invalidateCache() {
  cache = new Map();
  cacheExpiresAt = 0;
}

async function getGlobalSettings(client = prisma) {
  try {
    return await client.afterHoursSettings.upsert({ where: { id: GLOBAL_ID }, update: {}, create: { id: GLOBAL_ID } });
  } catch (error) {
    // Dois processos criando o padrão no primeiro boot: o perdedor relê.
    if (error?.code !== "P2002") throw error;
    return client.afterHoursSettings.findUnique({ where: { id: GLOBAL_ID } });
  }
}

// Configuração efetiva de uma empresa (própria ou a global). Cache curto:
// é lida a cada mensagem recebida e a cada tick do worker.
async function getEffectiveSettings(companyId = null, client = prisma) {
  const key = companyId || GLOBAL_SCOPE;
  if (client === prisma && Date.now() < cacheExpiresAt && cache.has(key)) return cache.get(key);
  const own = companyId ? await client.afterHoursSettings.findUnique({ where: { companyId } }) : null;
  const settings = own || await getGlobalSettings(client);
  if (client === prisma) {
    if (Date.now() >= cacheExpiresAt) { cache = new Map(); cacheExpiresAt = Date.now() + CACHE_TTL_MS; }
    cache.set(key, settings);
  }
  return settings;
}

// --------------------------------------------------------- Permissões

async function supervisorCompanyIds(user) {
  if (!user) return [];
  return (await companyService.companyAccess(user)).filter((entry) => entry.role === "SUPERVISOR").map((entry) => entry.companyId);
}

async function viewableCompanyIds(user) {
  if (authorization.isMaster(user)) return companyService.accessibleCompanyIds(user);
  return supervisorCompanyIds(user);
}

async function assertCanView(user) {
  if (authorization.isMaster(user)) return;
  if (!(await supervisorCompanyIds(user)).length) throw authorization.forbidden("Você não pode visualizar as regras de atendimento fora do expediente.");
}

// companyId nulo = regra global (só Master).
async function canEdit(user, companyId) {
  if (authorization.isMaster(user)) return true;
  if (!companyId) return false;
  const scoped = await companyService.userForCompany(user, companyId);
  return scoped?.role === "SUPERVISOR" && Boolean(scoped.permissionFlags?.canManageAfterHours);
}

async function assertCanEdit(user, companyId) {
  if (!(await canEdit(user, companyId))) {
    throw authorization.forbidden(companyId
      ? "Você não tem permissão para alterar as regras fora do expediente desta empresa."
      : "Somente uma conta Master pode alterar as regras globais de atendimento fora do expediente.");
  }
}

// `company` (slug/id) → companyId acessível ao usuário, ou null (global).
async function resolveCompany(user, company) {
  if (!company || company === "ALL" || company === GLOBAL_SCOPE) return null;
  const [companyId] = await companyService.resolveCompanyFilter(user, company);
  if (!companyId) throw fail("Empresa não encontrada.", 404);
  if (!authorization.isMaster(user) && !(await supervisorCompanyIds(user)).includes(companyId)) {
    throw authorization.forbidden("Você não supervisiona esta empresa.");
  }
  return companyId;
}

// --------------------------------------------------------- Configurações

function publicSettings(settings) {
  const { updatedByUserId: _updatedBy, ...rest } = settings;
  return rest;
}

async function getSettingsForViewer(viewer, { company } = {}) {
  await assertCanView(viewer);
  const companyId = await resolveCompany(viewer, company);
  // Supervisor sem empresa escolhida vê a global só para leitura.
  const own = companyId ? await prisma.afterHoursSettings.findUnique({ where: { companyId } }) : null;
  const settings = own || await getGlobalSettings();
  return {
    settings: publicSettings(settings),
    scope: companyId ? "COMPANY" : GLOBAL_SCOPE, companyId, isCompanyOverride: Boolean(own),
    canEdit: await canEdit(viewer, companyId), canEditGlobal: authorization.isMaster(viewer),
    // Regras fixas desta versão — exibidas na tela, nunca configuráveis.
    fixedRules: { freeFormOutsideWindow: "FORBIDDEN", realSendInTests: "FORBIDDEN", renewsWindow: false },
  };
}

const BOOLEAN_FIELDS = ["enabled", "remindOnSaturday", "remindOnSunday", "remindOnHolidays", "onlyPending", "onlyWithoutHuman", "quietHoursEnabled"];
const TIME_FIELDS = ["businessStartTime", "businessEndTime", "quietStartTime", "quietEndTime"];

function validTimezone(value) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
}

function validateSettings(data, current) {
  const update = {};
  for (const key of BOOLEAN_FIELDS) {
    if (data[key] === undefined) continue;
    if (typeof data[key] !== "boolean") throw fail(`"${key}" deve ser verdadeiro ou falso.`);
    update[key] = data[key];
  }
  for (const key of TIME_FIELDS) {
    if (data[key] === undefined) continue;
    if (calendar.minutesOf(data[key]) === null) throw fail(`"${key}" deve estar no formato HH:MM.`);
    update[key] = data[key];
  }
  if (data.timezone !== undefined) {
    if (typeof data.timezone !== "string" || !validTimezone(data.timezone)) throw fail("Fuso horário inválido.");
    update.timezone = data.timezone;
  }
  if (data.businessDays !== undefined) {
    const days = Array.isArray(data.businessDays) ? [...new Set(data.businessDays.map(Number))].sort() : null;
    if (!days || !days.length || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw fail("Escolha ao menos um dia de funcionamento.");
    update.businessDays = days;
  }
  for (const [key, min, max, label] of [["delayMinutes", 30, 1380, "O tempo de espera"], ["metaSafetyMarginMinutes", 5, 240, "A margem de segurança"]]) {
    if (data[key] === undefined) continue;
    const value = Number(data[key]);
    if (!Number.isInteger(value) || value < min || value > max) throw fail(`${label} deve ficar entre ${min} e ${max} minutos.`);
    update[key] = value;
  }
  if (data.maxPerCycle !== undefined) {
    // Sem insistência automática: um lembrete por ciclo nesta versão.
    if (Number(data.maxPerCycle) !== 1) throw fail("Nesta versão o limite é de 1 lembrete por ciclo de espera.");
    update.maxPerCycle = 1;
  }
  if (data.reminderMessage !== undefined) {
    const text = typeof data.reminderMessage === "string" ? data.reminderMessage.trim() : "";
    if (!text || text.length > 1000) throw fail("A mensagem do lembrete deve ter entre 1 e 1000 caracteres.");
    update.reminderMessage = text;
  }
  const merged = { ...current, ...update };
  if (calendar.minutesOf(merged.businessStartTime) >= calendar.minutesOf(merged.businessEndTime)) {
    throw fail("O horário de encerramento deve ser depois do horário de início.");
  }
  if (merged.quietHoursEnabled && merged.quietStartTime === merged.quietEndTime) {
    throw fail("O horário de silêncio precisa ter início e fim diferentes.");
  }
  // O lembrete precisa caber na janela de 24 h com a margem de segurança.
  if (merged.delayMinutes + merged.metaSafetyMarginMinutes >= 24 * 60) {
    throw fail("Tempo de espera + margem de segurança precisam ser menores que 24 horas (janela da Meta).");
  }
  if (!Object.keys(update).length) throw fail("Informe ao menos um campo para atualizar.");
  return update;
}

async function updateSettings(data, actor) {
  const companyId = await resolveCompany(actor, data.company);
  await assertCanEdit(actor, companyId);
  const global = await getGlobalSettings();
  const existing = companyId ? await prisma.afterHoursSettings.findUnique({ where: { companyId } }) : global;
  const update = validateSettings(data, existing || global);
  let settings;
  if (companyId && !existing) {
    const { id: _id, companyId: _companyId, createdAt: _createdAt, updatedAt: _updatedAt, ...globalValues } = global;
    settings = await prisma.afterHoursSettings.create({ data: { ...globalValues, ...update, id: `company:${companyId}`, companyId, updatedByUserId: actor.id } });
  } else {
    settings = await prisma.afterHoursSettings.update({ where: { id: existing.id }, data: { ...update, updatedByUserId: actor.id } });
  }
  invalidateCache();
  await audit.recordAudit({
    actor, action: "AFTER_HOURS_SETTINGS_UPDATED", entityType: "AFTER_HOURS_SETTINGS", entityId: settings.id, companyId,
    summary: companyId ? "Atualizou as regras fora do expediente da empresa" : "Atualizou as regras globais fora do expediente",
    details: { changed: Object.keys(update), before: existing ? publicSettings(existing) : null, after: publicSettings(settings) },
  });
  return getSettingsForViewer(actor, { company: companyId || undefined });
}

async function resetCompanySettings(company, actor) {
  const companyId = await resolveCompany(actor, company);
  if (!companyId) throw fail("Informe a empresa.");
  await assertCanEdit(actor, companyId);
  const removed = await prisma.afterHoursSettings.deleteMany({ where: { companyId } });
  invalidateCache();
  await audit.recordAudit({
    actor, action: "AFTER_HOURS_SETTINGS_COMPANY_RESET", entityType: "AFTER_HOURS_SETTINGS", entityId: null, companyId,
    summary: "Empresa voltou a usar as regras globais fora do expediente", details: { removed: removed.count },
  });
  return getSettingsForViewer(actor, { company: companyId });
}

// --------------------------------------------------------- Feriados

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDate(value) {
  const match = DATE_PATTERN.exec(String(value || ""));
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

function validateHoliday(data, current = {}) {
  const row = {};
  if (data.date !== undefined) {
    if (!validDate(data.date)) throw fail("Data inválida (use AAAA-MM-DD).");
    row.date = data.date;
  }
  if (data.name !== undefined) {
    const name = typeof data.name === "string" ? data.name.trim() : "";
    if (!name || name.length > 120) throw fail("O nome do feriado deve ter entre 1 e 120 caracteres.");
    row.name = name;
  }
  if (data.scope !== undefined) {
    if (!HOLIDAY_SCOPES.includes(data.scope)) throw fail("Abrangência inválida.");
    row.scope = data.scope;
  }
  if (data.region !== undefined) {
    const region = typeof data.region === "string" ? data.region.trim() : "";
    if (region.length > 80) throw fail("A região deve ter no máximo 80 caracteres.");
    row.region = region || null;
  }
  for (const key of ["allDay", "active"]) {
    if (data[key] === undefined) continue;
    if (typeof data[key] !== "boolean") throw fail(`"${key}" deve ser verdadeiro ou falso.`);
    row[key] = data[key];
  }
  for (const key of ["openTime", "closeTime"]) {
    if (data[key] === undefined) continue;
    if (data[key] === null || data[key] === "") { row[key] = null; continue; }
    if (calendar.minutesOf(data[key]) === null) throw fail("Horário especial deve estar no formato HH:MM.");
    row[key] = data[key];
  }
  const merged = { allDay: true, ...current, ...row };
  if (merged.allDay === false) {
    if (calendar.minutesOf(merged.openTime) === null || calendar.minutesOf(merged.closeTime) === null
      || calendar.minutesOf(merged.openTime) >= calendar.minutesOf(merged.closeTime)) {
      throw fail("Expediente especial: informe abertura e encerramento (encerramento depois da abertura).");
    }
  } else {
    row.openTime = null;
    row.closeTime = null;
  }
  return row;
}

function holidayView(row) {
  return {
    id: row.id || null, date: row.date, name: row.name, scope: row.scope, region: row.region || null,
    allDay: row.allDay !== false, openTime: row.openTime || null, closeTime: row.closeTime || null,
    active: row.active !== false, scopeKey: row.scopeKey, builtin: Boolean(row.builtin),
  };
}

// Lista do ano para o escopo (empresa ou global): linhas cadastradas +
// nacionais calculados ainda não cadastrados, com o que vale de fato.
async function listHolidays(viewer, { company, year } = {}) {
  await assertCanView(viewer);
  const companyId = await resolveCompany(viewer, company);
  const targetYear = Number(year) || new Date().getUTCFullYear();
  if (targetYear < 2000 || targetYear > 2100) throw fail("Ano inválido.");
  const rows = await prisma.businessHoliday.findMany({
    where: { scopeKey: { in: [GLOBAL_SCOPE, ...(companyId ? [companyId] : [])] }, date: { startsWith: `${targetYear}-` } },
    orderBy: { date: "asc" },
  });
  const dates = new Set([...rows.map((row) => row.date), ...calendar.nationalHolidays(targetYear).map((row) => row.date)]);
  const holidays = [...dates].sort().map((date) => {
    const own = rows.find((row) => row.date === date && row.scopeKey === (companyId || GLOBAL_SCOPE));
    const inherited = companyId ? rows.find((row) => row.date === date && row.scopeKey === GLOBAL_SCOPE) : null;
    const builtin = calendar.nationalHolidays(targetYear).find((row) => row.date === date);
    const shown = own || inherited || builtin;
    return {
      ...holidayView(shown),
      source: own ? "OWN" : inherited ? "GLOBAL" : "BUILTIN",
      effective: Boolean(calendar.holidayFor(date, rows, companyId)),
    };
  });
  return { year: targetYear, scope: companyId ? "COMPANY" : GLOBAL_SCOPE, companyId, canEdit: await canEdit(viewer, companyId), holidays };
}

async function createHoliday(data, actor) {
  const companyId = await resolveCompany(actor, data.company);
  await assertCanEdit(actor, companyId);
  const row = validateHoliday({ scope: companyId ? "EMPRESA" : "NACIONAL", allDay: true, active: true, ...data });
  if (!row.date || !row.name) throw fail("Informe a data e o nome do feriado.");
  try {
    const holiday = await prisma.businessHoliday.create({ data: {
      ...row, scopeKey: companyId || GLOBAL_SCOPE, companyId, createdByUserId: actor.id, updatedByUserId: actor.id,
    } });
    invalidateCache();
    await audit.recordAudit({
      actor, action: "BUSINESS_HOLIDAY_CREATED", entityType: "BUSINESS_HOLIDAY", entityId: holiday.id, companyId,
      summary: `Cadastrou o feriado ${holiday.name} (${holiday.date})`, details: holidayView(holiday),
    });
    return holidayView(holiday);
  } catch (error) {
    if (error.code === "P2002") throw fail("Já existe uma data cadastrada neste dia para este escopo — edite a existente.", 409);
    throw error;
  }
}

async function updateHoliday(id, data, actor) {
  const current = await prisma.businessHoliday.findUnique({ where: { id } });
  if (!current) throw fail("Feriado não encontrado.", 404);
  await assertCanView(actor);
  if (current.companyId) await resolveCompany(actor, current.companyId);
  await assertCanEdit(actor, current.companyId);
  const { company: _company, ...fields } = data || {};
  const row = validateHoliday(fields, current);
  try {
    const holiday = await prisma.businessHoliday.update({ where: { id }, data: { ...row, updatedByUserId: actor.id } });
    await audit.recordAudit({
      actor, action: "BUSINESS_HOLIDAY_UPDATED", entityType: "BUSINESS_HOLIDAY", entityId: id, companyId: current.companyId,
      summary: `Alterou o feriado ${holiday.name} (${holiday.date})${current.active !== holiday.active ? (holiday.active ? " — reativado" : " — desativado") : ""}`,
      details: { before: holidayView(current), after: holidayView(holiday) },
    });
    return holidayView(holiday);
  } catch (error) {
    if (error.code === "P2002") throw fail("Já existe uma data cadastrada neste dia para este escopo.", 409);
    throw error;
  }
}

// Materializa os feriados nacionais do ano no escopo (idempotente) para que
// possam ser editados ou desativados individualmente.
async function importNationalHolidays({ company, year }, actor) {
  const companyId = await resolveCompany(actor, company);
  await assertCanEdit(actor, companyId);
  const targetYear = Number(year);
  if (!Number.isInteger(targetYear) || targetYear < 2000 || targetYear > 2100) throw fail("Ano inválido.");
  const scopeKey = companyId || GLOBAL_SCOPE;
  const created = await prisma.businessHoliday.createMany({
    data: calendar.nationalHolidays(targetYear).map(({ date, name }) => ({
      scopeKey, companyId, date, name, scope: "NACIONAL", allDay: true, active: true, createdByUserId: actor.id, updatedByUserId: actor.id,
    })),
    skipDuplicates: true,
  });
  await audit.recordAudit({
    actor, action: "BUSINESS_HOLIDAY_IMPORTED", entityType: "BUSINESS_HOLIDAY", entityId: null, companyId,
    summary: `Adicionou os feriados nacionais de ${targetYear}`, details: { year: targetYear, created: created.count },
  });
  return { created: created.count };
}

// Feriados do escopo nas datas pedidas (uso interno do lembrete).
async function holidaysForDates(companyId, dates, client = prisma) {
  return client.businessHoliday.findMany({ where: { scopeKey: { in: [GLOBAL_SCOPE, ...(companyId ? [companyId] : [])] }, date: { in: dates } } });
}

module.exports = {
  GLOBAL_SCOPE, HOLIDAY_SCOPES,
  assertCanEdit, assertCanView, canEdit, createHoliday, getEffectiveSettings, getGlobalSettings, getSettingsForViewer,
  holidaysForDates, importNationalHolidays, invalidateCache, listHolidays, resetCompanySettings, resolveCompany,
  supervisorCompanyIds, updateHoliday, updateSettings, viewableCompanyIds,
};
