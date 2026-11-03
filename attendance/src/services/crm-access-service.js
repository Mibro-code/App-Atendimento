const { opaque } = require('./central-identity-crypto');
const fail = (message, statusCode = 409) => Object.assign(Error(message), { statusCode });
const email = value => String(value || '').trim().toLowerCase();

// Attendance is the permission authority. A remote call never runs inside a
// database transaction. Reservations remain disabled until both sides agree.
function createCrmAccessService(prisma) {
  async function reserve(input) {
    const { crmUserId, crmEmail, crmRole, manual = false, attendanceUserId } = input;
    if (typeof crmUserId !== 'string' || !crmUserId || crmUserId.length > 128 ||
        typeof crmEmail !== 'string' || !email(crmEmail) || crmEmail.length > 254 ||
        typeof manual !== 'boolean' || (manual && (typeof attendanceUserId !== 'string' || !attendanceUserId || attendanceUserId.length > 128)) ||
        !['ADMIN', 'SUPERVISOR', 'VENDEDOR'].includes(crmRole)) throw fail('Conta CRM não elegível.', 400);
    return prisma.$transaction(async tx => {
      const rows = await tx.user.findMany({ where: manual ? { id: attendanceUserId } :
        { email: { equals: email(crmEmail), mode: 'insensitive' } }, take: 2 });
      if (!rows.length) return { status: 'NO_MATCH' };
      if (rows.length !== 1) throw fail('E-mail ambíguo; revise os cadastros.');
      const user = rows[0];
      if (!user.active || user.role === 'BOT') throw fail('Conta do Atendimento inativa ou não elegível.');
      const link = await tx.centralCrmIdentity.findUnique({ where: { attendanceUserId: user.id } });
      // Different e-mails only preserve an existing, explicitly confirmed pair.
      if (email(user.email) !== email(crmEmail) && link?.crmUserId !== crmUserId) throw fail('Os e-mails são diferentes. Não foi criado um vínculo.');
      if (link && link.crmUserId !== crmUserId) throw fail('A conta já está vinculada a outra identidade.');
      if (link && !link.enabled && !manual && !link.confirmation.startsWith('PENDING:')) return { status: 'DISABLED' };
      if (link?.enabled) return { status: 'LINKED', attendanceUserId: user.id, primaryEmail: email(user.email), crmUserId };
      const confirmation = `PENDING:${opaque()}`;
      if (link) {
        const changed = await tx.centralCrmIdentity.updateMany({ where: { id: link.id, confirmation: link.confirmation, enabled: false }, data: { confirmation } });
        if (changed.count !== 1) throw fail('O acesso mudou. Atualize e tente novamente.');
      } else await tx.centralCrmIdentity.create({ data: { attendanceUserId: user.id, crmUserId, enabled: false, confirmation } });
      return { status: 'PENDING', attendanceUserId: user.id, primaryEmail: email(user.email), crmUserId, confirmation };
    });
  }
  async function commit({ attendanceUserId, crmUserId, confirmation, primaryEmail }) {
    if (typeof confirmation !== 'string' || !/^PENDING:[A-Za-z0-9_-]{43}$/.test(confirmation)) throw fail('Confirmação inválida.', 400);
    return prisma.$transaction(async tx => {
      const user = await tx.user.findUnique({ where: { id: attendanceUserId } });
      if (!user?.active || user.role === 'BOT' || email(user.email) !== primaryEmail) throw fail('A conta mudou durante a vinculação.');
      const result = await tx.centralCrmIdentity.updateMany({ where: { attendanceUserId, crmUserId, enabled: false, confirmation }, data: { enabled: true, confirmation: 'EMAIL_CONFIRMED' } });
      if (result.count !== 1) throw fail('O acesso mudou durante a vinculação. Atualize e confira o estado atual.');
      await tx.auditLog.create({ data: { action: 'CRM_ACCESS_ENABLED', entityType: 'USER', entityId: attendanceUserId, summary: 'Acesso compartilhado ao CRM ativado.', details: { crmUserId } } });
      return { status: 'LINKED' };
    });
  }
  async function disable(attendanceUserId, actor) {
    return prisma.$transaction(async tx => {
      const result = await tx.centralCrmIdentity.updateMany({ where: { attendanceUserId }, data: { enabled: false, confirmation: 'MASTER_DISABLED' } });
      if (result.count) await tx.auditLog.create({ data: { actorUserId: actor.id, actorName: actor.name, actorEmail: actor.email,
        action: 'CRM_ACCESS_DISABLED', entityType: 'USER', entityId: attendanceUserId, summary: 'Acesso compartilhado ao CRM desativado.' } });
      return { status: 'DISABLED' };
    });
  }
  return { reserve, commit, disable };
}
module.exports = { createCrmAccessService };
