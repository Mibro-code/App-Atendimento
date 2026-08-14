const audit = require("../services/audit-service");

module.exports = {
  async list(req, res, next) {
    try { return res.json(await audit.listAuditLogs(req.query, req.user)); }
    catch (error) { return next(error); }
  },
};
