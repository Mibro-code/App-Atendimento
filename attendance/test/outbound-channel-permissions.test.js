const test = require('node:test');
const assert = require('node:assert/strict');
const authorization = require('../src/services/authorization-service');
const { publicUser } = require('../src/services/auth-service');
const prisma = require('../src/database/prisma');
const outbound = require('../src/services/outbound-conversation-service');
const bulk = require('../src/services/outbound-bulk-service');

for (const role of ['ATENDENTE', 'SUPERVISOR']) {
  test(`${role}: e-mail e WhatsApp são independentes, mesmo com flag antigo ligado`, async () => {
    const email = { role, canStartConversations: true, canStartEmailConversations: true, canStartWhatsAppConversations: false };
    const whatsapp = { role, canStartConversations: true, canStartEmailConversations: false, canStartWhatsAppConversations: true };
    assert.equal(authorization.canStartConversations(email, 'EMAIL'), true);
    assert.equal(authorization.canStartConversations(email, 'META'), false);
    assert.equal(authorization.canStartConversations(whatsapp, 'EMAIL'), false);
    assert.equal(authorization.canStartConversations(whatsapp, 'META'), true);
    assert.equal(publicUser(email).canStartConversations, true);
    assert.equal(publicUser(email).canStartWhatsAppConversations, false);
    await assert.rejects(outbound.createOutboundEmail({ user: whatsapp }), (e) => e.statusCode === 403);
    await assert.rejects(outbound.createOutboundConversation({ user: email }), (e) => e.statusCode === 403);
    await assert.rejects(bulk.listSenderNumbers(email), (e) => e.statusCode === 403);
  });
}
test('Master mantém ambas; flag legado não reativa permissão revogada', () => {
  assert.equal(authorization.canStartConversations({ role: 'ADMIN' }, 'EMAIL'), true);
  assert.equal(authorization.canStartConversations({ role: 'ADMIN' }, 'META'), true);
  assert.equal(authorization.canStartConversations({ role: 'ATENDENTE', canStartConversations: true }), false);
});
test('listagem só habilita o canal permitido', async () => {
  const user = await prisma.user.create({ data: { companyAccess: { create: { companyId: 'cmp_mibro' } }, role: 'ATENDENTE', name: 'Teste canais', email: `split-${process.pid}@teste.local` } });
  const ids = [];
  try {
  for (const channel of ['EMAIL', 'META']) {
    const account = await prisma.channelAccount.create({ data: { companyId: 'cmp_mibro', channel, name: 'Conta teste', status: 'CONNECTED', enabled: true, accessUsers: { create: { userId: user.id } }, config: {} } });
    ids.push(account.id);
  }
  const email = await outbound.listOutboundChannels({ ...user, canStartEmailConversations: true });
  assert.equal(email.find((x) => x.channel === 'EMAIL').enabled, true);
  assert.equal(email.find((x) => x.channel === 'META').enabled, false);
  const whatsapp = await outbound.listOutboundChannels({ ...user, canStartWhatsAppConversations: true });
  assert.equal(whatsapp.find((x) => x.channel === 'EMAIL').enabled, false);
  assert.equal(whatsapp.find((x) => x.channel === 'META').enabled, true);
  assert.equal(whatsapp.find((x) => x.channel === 'META').modes.individual, true);
  } finally {
    await prisma.channelAccount.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});
test.after(async () => prisma.$disconnect());
