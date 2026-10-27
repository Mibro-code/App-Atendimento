const auth = require("../services/auth-service");

async function authenticate(req, res, next) {
  try {
    const user = await auth.userFromToken(req.cookies[auth.COOKIE_NAME]);
    if (!user) return res.status(401).json({ error: "Autenticação necessária." });
    req.user = auth.publicUser(user);
    return next();
  } catch (error) { return next(error); }
}

async function requirePageAuth(req, res, next) {
  try {
    const user = await auth.userFromToken(req.cookies[auth.COOKIE_NAME]);
    if (!user) return res.redirect("/login.html");
    req.user = auth.publicUser(user);
    return next();
  } catch (error) { return next(error); }
}

async function requireMasterPage(req, res, next) {
  try {
    const user = await auth.userFromToken(req.cookies[auth.COOKIE_NAME]);
    if (!user) return res.redirect("/login.html");
    if (user.role !== "ADMIN") return res.status(403).send("Acesso restrito a conta Master.");
    req.user = auth.publicUser(user);
    return next();
  } catch (error) { return next(error); }
}

// Campanhas (item 27): Admin/Supervisor por padrão, ou um Atendente com o
// flag canManageCampaigns — mesma regra de auth-service.js#publicUser.
async function requireCampaignsPage(req, res, next) {
  try {
    const user = await auth.userFromToken(req.cookies[auth.COOKIE_NAME]);
    if (!user) return res.redirect("/login.html");
    const publicUser = auth.publicUser(user);
    // Multiempresa: abre se puder gerenciar campanhas em ALGUMA empresa (o
    // cargo/permissão pode variar por empresa); cada ação revalida a empresa.
    const companyIds = await require("../services/campaign-service").manageableCompanyIds(publicUser);
    if (!companyIds.length) return res.status(403).send("Acesso restrito ao Master ou usuários autorizados.");
    req.user = publicUser;
    return next();
  } catch (error) { return next(error); }
}

async function requireCampaignAccess(req, res, next) {
  try {
    const companyIds = await require("../services/campaign-service").manageableCompanyIds(req.user);
    if (!companyIds.length) return res.status(403).json({ error: "Você não tem permissão para acessar campanhas ou templates." });
    return next();
  } catch (error) { return next(error); }
}

// Configurações → Conversas (item 13): Admin edita, Supervisor só visualiza —
// mesma régua de "requireCampaignsPage", trocando o flag por checagem de role.
async function requireConversationSettingsPage(req, res, next) {
  try {
    const user = await auth.userFromToken(req.cookies[auth.COOKIE_NAME]);
    if (!user) return res.redirect("/login.html");
    const publicUser = auth.publicUser(user);
    if (publicUser.role !== "ADMIN" && publicUser.role !== "SUPERVISOR") {
      return res.status(403).send("Acesso restrito a Admin ou Supervisor.");
    }
    req.user = publicUser;
    return next();
  } catch (error) { return next(error); }
}

// Central de Operação: Master ou Supervisor em ALGUMA empresa (o escopo de
// cada empresa é revalidado em cada chamada da API).
async function requireOperationsPage(req, res, next) {
  try {
    const user = await auth.userFromToken(req.cookies[auth.COOKIE_NAME]);
    if (!user) return res.redirect("/login.html");
    const publicUser = auth.publicUser(user);
    if (!(await require("../services/operations-panel-service").canOpenPanel(publicUser))) {
      return res.status(403).send("Acesso restrito a Master ou Supervisor.");
    }
    req.user = publicUser;
    return next();
  } catch (error) { return next(error); }
}

// Fora do expediente: Master ou Supervisor em alguma empresa (a edição é
// revalidada por empresa em cada chamada da API).
async function requireAfterHoursPage(req, res, next) {
  try {
    const user = await auth.userFromToken(req.cookies[auth.COOKIE_NAME]);
    if (!user) return res.redirect("/login.html");
    const publicUser = auth.publicUser(user);
    try { await require("../services/after-hours-settings-service").assertCanView(publicUser); }
    catch { return res.status(403).send("Acesso restrito a Master ou Supervisor."); }
    req.user = publicUser;
    return next();
  } catch (error) { return next(error); }
}

// Produtividade e Qualidade: mesma régua das APIs (report-access-service).
async function requireReportsPage(req, res, next) {
  try {
    const user = await auth.userFromToken(req.cookies[auth.COOKIE_NAME]);
    if (!user) return res.redirect("/login.html");
    const publicUser = auth.publicUser(user);
    if (!(await require("../services/report-access-service").canOpenReports(publicUser))) {
      return res.status(403).send("Acesso restrito a Master, Supervisor ou a quem tem \"Ver minha produtividade\".");
    }
    req.user = publicUser;
    return next();
  } catch (error) { return next(error); }
}

module.exports = {
  authenticate, requireAfterHoursPage, requireCampaignAccess, requireCampaignsPage, requireConversationSettingsPage, requireMasterPage, requireOperationsPage, requirePageAuth,
  requireReportsPage,
};
