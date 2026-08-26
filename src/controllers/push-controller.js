const pushService = require("../services/push-service");

module.exports = {
  async publicKey(req, res, next) {
    try { return res.json({ publicKey: pushService.publicKey(), enabled: pushService.isEnabled() }); }
    catch (error) { return next(error); }
  },

  async subscribe(req, res, next) {
    try {
      const device = await pushService.saveSubscription(req.user, req.body.subscription, {
        deviceLabel: req.body.deviceLabel, userAgent: req.get("user-agent"),
      });
      return res.status(201).json(device);
    } catch (error) { return next(error); }
  },

  async listDevices(req, res, next) {
    try { return res.json(await pushService.listDevices(req.user.id)); }
    catch (error) { return next(error); }
  },

  async removeDevice(req, res, next) {
    try { return res.json(await pushService.removeDevice(req.params.id, req.user)); }
    catch (error) { return next(error); }
  },
};
