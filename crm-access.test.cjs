const test = require('node:test'), assert = require('node:assert/strict');
const { createCrmAccessService } = require('./attendance/src/services/crm-access-service');
function fixture() {
  const user = { id: 'a', name: 'Pessoa', email: 'person@example.invalid', active: true, role: 'ATENDENTE', passwordHash: 'unchanged', sessionVersion: 7 };
  let link = null;
  const audits = [];
  const db = {
    user: { findMany: async ({ where }) => where.id ? (where.id === user.id ? [user] : []) : user.email.toLowerCase() === where.email.equals ? [user] : [], findUnique: async () => user },
    centralCrmIdentity: {
      findUnique: async () => link && { ...link },
      create: async ({ data }) => { link = { id: 'l', ...data }; return link; },
      updateMany: async ({ where, data }) => {
        if (!link || Object.entries(where).some(([key, value]) => link[key] !== value)) return { count: 0 };
        Object.assign(link, data); return { count: 1 };
      },
    },
    auditLog: { create: async ({ data }) => { audits.push(data); } },
    $transaction: async fn => fn(db),
  };
  return { service: createCrmAccessService(db), db, user, audits, get link() { return link; }, input: { crmUserId: 'c', crmEmail: 'PERSON@example.invalid', crmRole: 'VENDEDOR' } };
}
test('same email reserves disabled, then commits without changing passwords/roles', async () => {
  const f = fixture(), before = { ...f.user }, plan = await f.service.reserve(f.input);
  assert.equal(plan.status, 'PENDING'); assert.equal(f.link.enabled, false);
  await f.service.commit(plan); assert.equal(f.link.enabled, true);
  assert.deepEqual(f.user, before); assert.equal(f.audits[0].action, 'CRM_ACCESS_ENABLED');
  assert.equal((await f.service.reserve(f.input)).status, 'LINKED');
});
test('no matching email never creates a link', async () => {
  const f = fixture(); assert.equal((await f.service.reserve({ ...f.input, crmEmail: 'other@example.invalid' })).status, 'NO_MATCH'); assert.equal(f.link, null);
});
test('representatives and unsupported CRM roles are excluded', async () => {
  for (const crmRole of ['REPRESENTANTE', 'BOT', '', null]) { const f = fixture(); await assert.rejects(f.service.reserve({ ...f.input, crmRole })); assert.equal(f.link, null); }
});
test('inactive Attendance users and bots are excluded', async () => {
  for (const patch of [{ active: false }, { role: 'BOT' }]) { const f = fixture(); Object.assign(f.user, patch); await assert.rejects(f.service.reserve(f.input)); assert.equal(f.link, null); }
});
test('manual mismatched emails cannot create a new link', async () => {
  const f = fixture(); await assert.rejects(f.service.reserve({ ...f.input, manual: true, attendanceUserId: 'a', crmEmail: 'other@example.invalid' }));
});
test('existing explicitly confirmed different-email pair is preserved', async () => {
  const f = fixture(); const plan = await f.service.reserve(f.input); await f.service.commit(plan);
  assert.equal((await f.service.reserve({ ...f.input, crmEmail: 'original@example.invalid', manual: true, attendanceUserId: 'a' })).status, 'LINKED');
});
test('different CRM identity cannot replace an existing link', async () => {
  const f = fixture(); await f.service.reserve(f.input); await assert.rejects(f.service.reserve({ ...f.input, crmUserId: 'other' })); assert.equal(f.link.crmUserId, 'c');
});
test('ambiguous email blocks linking', async () => {
  const f = fixture(); f.db.user.findMany = async () => [f.user, { ...f.user, id: 'a2' }]; await assert.rejects(f.service.reserve(f.input)); assert.equal(f.link, null);
});
test('disable cancels in-flight activation and automatic creation never overrides it', async () => {
  const f = fixture(), plan = await f.service.reserve(f.input);
  await f.service.disable('a', { id: 'master' });
  await assert.rejects(f.service.commit(plan)); assert.equal(f.link.enabled, false);
  assert.equal((await f.service.reserve(f.input)).status, 'DISABLED');
  assert.equal(f.audits[0].action, 'CRM_ACCESS_DISABLED');
});
test('Master can explicitly reactivate an existing disabled pair', async () => {
  const f = fixture(); await f.service.reserve(f.input); await f.service.disable('a', { id: 'master' });
  const plan = await f.service.reserve({ ...f.input, manual: true, attendanceUserId: 'a' }); await f.service.commit(plan); assert.equal(f.link.enabled, true);
});
test('superseded reservation cannot commit and a repeated commit fails', async () => {
  const f = fixture(), first = await f.service.reserve(f.input), second = await f.service.reserve(f.input);
  await assert.rejects(f.service.commit(first)); await f.service.commit(second); await assert.rejects(f.service.commit(second));
});
test('account changes before commit fail closed', async () => {
  for (const patch of [{ active: false }, { role: 'BOT' }, { email: 'changed@example.invalid' }]) {
    const f = fixture(), plan = await f.service.reserve(f.input); Object.assign(f.user, patch); await assert.rejects(f.service.commit(plan)); assert.equal(f.link.enabled, false);
  }
});
