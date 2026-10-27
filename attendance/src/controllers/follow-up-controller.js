// Agenda e Follow-ups. Regras e RBAC ficam no serviço (follow-up-service.js).
const followUps = require("../services/follow-up-service");
const contactProfile = require("../services/contact-profile-service");

const handler = (fn, status = 200) => async (req, res, next) => {
  try { return res.status(status).json(await fn(req)); } catch (error) { return next(error); }
};

module.exports = {
  list: handler((req) => followUps.listFollowUps(req.user, req.query)),
  summary: handler((req) => followUps.summaryFor(req.user)),
  options: handler((req) => followUps.formOptions(req.user, req.query)),
  get: handler((req) => followUps.getFollowUp(req.user, req.params.id)),
  create: handler((req) => followUps.createFromRequest(req.user, req.body || {}), 201),
  update: handler((req) => followUps.updateFollowUp(req.user, req.params.id, req.body || {})),
  complete: handler((req) => followUps.completeFollowUp(req.user, req.params.id, req.body || {})),
  cancel: handler((req) => followUps.cancelFollowUp(req.user, req.params.id, req.body || {})),
  forContact: handler((req) => followUps.listForContact(req.user, req.params.contactId)),
  // Perfil 360° do cliente (só leitura, paginado).
  profile: handler((req) => contactProfile.getProfile(req.user, req.params.contactId)),
  timeline: handler((req) => contactProfile.getTimeline(req.user, req.params.contactId, req.query)),
};
