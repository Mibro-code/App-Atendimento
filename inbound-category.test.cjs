const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyInboundCategory } = require('./attendance/src/services/inbound-category-service');
const account = { id: 'commercial', companyId: 'mibro', channel: 'META', enabled: true, config: { inboundCategoryId: 'atacado' } };
function fixture(overrides = {}) {
  const chat = { id: 'chat', companyId: 'mibro', channel: 'META', channelAccountId: 'commercial', categoryId: null, assignedUserId: null, archivedAt:null, status: 'NOVO', ...overrides };
  const activities = []; let reads = 0;
  const db = {
    category: { findFirst: async ({ where }) => { reads++; assert.deepEqual(where, { id: 'atacado', companyId: 'mibro', active: true, masterOnly: false }); return { id: 'atacado' }; } },
    conversation: { updateMany: async ({ where, data }) => {
      const matches = Object.entries(where).every(([key, value]) => key === 'status' ? value.in.includes(chat.status) : chat[key] === value);
      if (matches) Object.assign(chat, data);
      return { count: Number(matches) };
    } },
    conversationActivity: { create: async ({ data }) => activities.push(data) },
  };
  return { db, chat, activities, reads: () => reads };
}
test('new inbound is classified once without changing status or owner', async () => {
  const f = fixture();
  assert.equal(await applyInboundCategory(f.db, { account, conversationId: 'chat' }), true);
  assert.equal(f.chat.categoryId, 'atacado'); assert.equal(f.chat.status, 'NOVO'); assert.equal(f.chat.assignedUserId, null);
  assert.equal(await applyInboundCategory(f.db, { account, conversationId: 'chat' }), false);
  assert.equal(f.activities.length, 1);
});
for (const [name, patch] of Object.entries({
  categorized: { categoryId: 'support' }, assigned: { assignedUserId: 'seller' },
  otherCompany: { companyId: 'sincrofit' }, otherNumber: { channelAccountId: 'main' },
  finalized: { status: 'FINALIZADO' }, active: { status: 'EM_ATENDIMENTO' },
  archived: { archivedAt: new Date() },
})) test(`preserves ${name}`, async () => {
  const f = fixture(patch), before = { ...f.chat };
  assert.equal(await applyInboundCategory(f.db, { account, conversationId: 'chat' }), false);
  assert.deepEqual(f.chat, before); assert.equal(f.activities.length, 0);
});
for (const [name, patch] of Object.entries({ noConfig: { config: {} }, disabled: { enabled: false }, otherChannel: { channel: 'EMAIL' }, restricted: { config: { inboundCategoryId: 'atacado', allowedCategoryIds: ['support'] } } })) {
  test(`no reads for ${name}`, async () => {
    const f = fixture(); assert.equal(await applyInboundCategory(f.db, { account: { ...account, ...patch }, conversationId: 'chat' }), false);
    assert.equal(f.reads(), 0);
  });
}
test('invalid/inactive/other-company category is ignored', async () => {
  const f = fixture(); f.db.category.findFirst = async () => null;
  assert.equal(await applyInboundCategory(f.db, { account, conversationId: 'chat' }), false);
  assert.equal(f.chat.categoryId, null);
});
test('bot and reopened unclassified conversation can be categorized', async () => {
  for (const status of ['BOT', 'NOVO']) {
    const f = fixture({ status }); assert.equal(await applyInboundCategory(f.db, { account, conversationId: 'chat' }), true);
  }
});
