// Atendimento fora do expediente — controller fino. Toda regra de permissão
// vive nos services (after-hours-settings-service / after-hours-reminder-service).
const settingsService = require("../services/after-hours-settings-service");
const reminders = require("../services/after-hours-reminder-service");

const handle = (fn) => async (req, res, next) => {
  try { return res.json(await fn(req)); } catch (error) { return next(error); }
};

module.exports = {
  getSettings: handle((req) => settingsService.getSettingsForViewer(req.user, { company: req.query.company })),
  updateSettings: handle((req) => settingsService.updateSettings(req.body || {}, req.user)),
  resetCompany: handle((req) => settingsService.resetCompanySettings(req.params.company, req.user)),
  listHolidays: handle((req) => settingsService.listHolidays(req.user, { company: req.query.company, year: req.query.year })),
  createHoliday: handle((req) => settingsService.createHoliday(req.body || {}, req.user)),
  updateHoliday: handle((req) => settingsService.updateHoliday(req.params.id, req.body || {}, req.user)),
  importNationalHolidays: handle((req) => settingsService.importNationalHolidays(req.body || {}, req.user)),
  monitor: handle((req) => reminders.getMonitor(req.user, { company: req.query.company, status: req.query.status, limit: req.query.limit, days: req.query.days })),
  reprocess: handle((req) => reminders.reprocessReminder(req.params.id, req.user)),
  cancel: handle((req) => reminders.cancelReminder(req.params.id, req.user)),
};
