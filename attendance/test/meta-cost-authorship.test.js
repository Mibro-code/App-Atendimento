require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/database/prisma');
const costs = require('../src/services/meta-cost-service');
const companies = require('../src/services/company-service');
const prefix = 'cost-author-review-';
const now = new Date('2026-10-14T15:00:00Z');
let userA, userB, accountA, accountB, contact, conversation;
let campaign;
const master = { id: 'cost-review-master', role: 'ADMIN' };
const id = (suffix) => prefix + suffix;

test.before(async () => {
  userA = await prisma.user.create({ data: { id: id('a'), email: id('a') + '@test.local', name: 'Autor A' } });
  userB = await prisma.user.create({ data: { id: id('b'), email: id('b') + '@test.local', name: 'Responsável atual B' } });
  accountA = await prisma.channelAccount.create({ data: { id: id('number-a'), name: id('number-a'), companyId: 'cmp_mibro', channel: 'META' } });
  accountB = await prisma.channelAccount.create({ data: { id: id('number-b'), name: id('number-b'), companyId: 'cmp_mibro', channel: 'META' } });
  contact = await prisma.contact.create({ data: { externalId: id('contact'), name: 'Fixture', phone: '5511990000000', companyId: 'cmp_mibro' } });
  conversation = await prisma.conversation.create({ data: { contactId: contact.id, companyId: 'cmp_mibro', assignedUserId: userB.id } });
  for (const [key, author, number, category, cost, rawPayload] of [
    ['a1', userA.id, accountA.id, 'MARKETING', '0.32', {}],
    ['a2', userA.id, accountB.id, 'MARKETING', '0.32', {}],
    ['b1', userB.id, accountA.id, 'SERVICE', '0', {}],
    ['bot', null, accountA.id, 'MARKETING', '0.32', { system: 'visual_flow' }],
    ['campaign', null, accountB.id, 'MARKETING', '0.32', {}],
    ['unknown', null, null, 'SERVICE', null, {}],
  ]) {
    const message = await prisma.message.create({ data: { conversationId: conversation.id, externalId: id(key), channel: 'META', direction: 'ENVIADA', status: 'ENTREGUE', type: category === 'SERVICE' ? 'text' : 'template', occurredAt: now, sentByUserId: author, channelAccountId: number, rawPayload } });
    await prisma.metaMessageCharge.create({ data: { messageId: message.id, conversationId: conversation.id, companyId: 'cmp_mibro', channelAccountId: number, messageType: message.type, category, estimatedCost: cost, sentAt: now } });
    if (key === 'campaign') {
      campaign = await prisma.campaign.create({ data: { name: id('campaign'), companyId: 'cmp_mibro', templateName: 'fixture', templateLanguage: 'pt_BR' } });
      await prisma.campaignContact.createMany({ data: ['5511990000001', '5511990000002'].map((phone) => ({ campaignId: campaign.id, phone, externalMessageId: message.externalId })) });
    }
  }
  companies.invalidateCompanyCache();
});

test.after(async () => {
  if (campaign) await prisma.campaign.delete({ where: { id: campaign.id } });
  if (contact) await prisma.contact.delete({ where: { id: contact.id } });
  await prisma.channelAccount.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.$disconnect();
});

const query = { from: '2026-10-14T14:59:59Z', to: '2026-10-14T15:00:01Z', company: 'mibro' };
test('autor original, múltiplos números, bot e sem autoria; detalhamento fecha com total', async () => {
  const report = await costs.getCostReport(master, query, { now });
  const rows = report.byAuthorAndNumber;
  const a = rows.filter((row) => row.userId === userA.id);
  assert.equal(a.length, 2);
  assert.equal(a.reduce((sum, row) => sum + row.estimatedCost, 0), 0.64);
  assert.ok(a.some((row) => row.channelAccountId === accountA.id));
  assert.ok(a.some((row) => row.channelAccountId === accountB.id));
  assert.equal(rows.find((row) => row.userId === userB.id).messages, 1, 'não atribui ao responsável B os envios de A');
  assert.equal(rows.find((row) => row.source === 'BOT').authorName, 'Bot');
  assert.equal(rows.find((row) => row.source === 'CAMPAIGN').messages, 1, 'vínculos repetidos não duplicam a cobrança');
  const unknown = rows.find((row) => row.source === 'UNATTRIBUTED');
  assert.equal(unknown.authorName, 'Sem autor registrado');
  assert.equal(unknown.accountName, 'Sem número vinculado');
  assert.equal(unknown.estimatedCost, null);
  assert.equal(unknown.unpricedCount, 1);
  assert.equal(Math.round(rows.reduce((sum, row) => sum + (row.estimatedCost || 0), 0) * 100) / 100, report.total.estimatedCost);
  assert.equal(rows.reduce((sum, row) => sum + row.templates, 0), report.total.templates);
  assert.equal(rows.reduce((sum, row) => sum + row.serviceMessages, 0), report.total.serviceMessages);
  assert.ok(rows.every((row) => !('rawPayload' in row) && !('phone' in row)));
});

test('filtro de número e empresa vale também no detalhamento', async () => {
  const report = await costs.getCostReport(master, { ...query, channelAccountId: accountB.id }, { now });
  assert.equal(report.byAuthorAndNumber.length, 2);
  assert.ok(report.byAuthorAndNumber.some((row) => row.userId === userA.id));
  assert.equal(report.total.estimatedCost, 0.64);
  const other = await costs.getCostReport(master, { ...query, company: 'sincrofit' }, { now });
  assert.equal(other.byAuthorAndNumber.length, 0);
});

test('não-Master continua sem acesso ao relatório e parâmetros não viram SQL', async () => {
  await assert.rejects(costs.getCostReport({ id: userA.id, role: 'ATENDENTE' }, query, { now }), { statusCode: 403 });
  const report = await costs.getCostReport(master, { ...query, channelAccountId: "' OR 1=1 --" }, { now });
  assert.equal(report.byAuthorAndNumber.length, 0);
});
