const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/database/prisma');
const inbox = require('../src/services/inbox-service');
const supervision = require('../src/services/supervision-service');

test('VPS supervisão e busca não expõem conteúdo nem contagens de mensagens do Financeiro', async () => {
  const tag = `integration-private-${Date.now()}`;
  const users = [];
  const categories = [];
  let contact;
  try {
    for (const [name, role] of [['Supervisor', 'SUPERVISOR'], ['Equipe', 'ATENDENTE']]) {
      users.push(await prisma.user.create({ data: { name, email: `${name}-${tag}@integration.test`, role, companyAccess: { create: { companyId: 'cmp_mibro' } } } }));
    }
    const [viewer, member] = users;
    await prisma.supervisorTeamMember.create({ data: { supervisorId: viewer.id, memberId: member.id } });
    categories.push(await prisma.category.create({ data: { companyId: 'cmp_mibro', code: `${tag}-fin`, name: 'Financeiro QA', visibilityMode: 'SECTOR_PRIVATE' } }));
    categories.push(await prisma.category.create({ data: { companyId: 'cmp_mibro', code: `${tag}-sup`, name: 'Suporte QA' } }));
    contact = await prisma.contact.create({ data: { companyId: 'cmp_mibro', externalId: tag, name: 'Contato QA', phone: '5511000000000' } });
    const conversation = await prisma.conversation.create({ data: { companyId: 'cmp_mibro', contactId: contact.id, categoryId: categories[0].id, assignedUserId: member.id, status: 'EM_ATENDIMENTO' } });
    await prisma.conversationAssignmentPeriod.create({ data: { conversationId: conversation.id, userId: member.id, startedAt: new Date(Date.now() - 60000), startReason: 'QA' } });
    await prisma.message.create({ data: { conversationId: conversation.id, sentByUserId: member.id, direction: 'ENVIADA', status: 'ENVIADA', type: 'text', text: `segredo-${tag}`, occurredAt: new Date() } });
    await prisma.conversationActivity.create({ data: { conversationId: conversation.id, action: 'CONVERSATION_TRANSFERRED', details: { from: 'Financeiro', to: 'Suporte', reason: `segredo-${tag}` } } });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { categoryId: categories[1].id } });
    await prisma.message.create({ data: { conversationId: conversation.id, sentByUserId: member.id, direction: 'ENVIADA', status: 'ENVIADA', type: 'text', text: `publico-${tag}`, occurredAt: new Date() } });
    assert.deepEqual(await inbox.searchConversations(`segredo-${tag}`, { ...viewer }), []);
    assert.equal((await inbox.searchConversations(`publico-${tag}`, { ...viewer }))[0].id, conversation.id);
    const timeline = await supervision.conversationTimeline({ ...viewer }, conversation.id);
    assert.equal(JSON.stringify(timeline).includes(`segredo-${tag}`), false);
    assert.equal(timeline.messagesByUser.find(row => row.userId === member.id).count, 1);
    const history = await supervision.memberConversations({ ...viewer }, member.id);
    assert.equal(history.rows.find(row => row.id === conversation.id).messagesSentByMember, 1);
    const access = await require('../src/services/report-access-service').resolveReportAccess({ ...viewer });
    const report = await require('../src/services/productivity-service').getProductivity(access, {period:'today'});
    assert.equal(report.agents.find(row=>row.userId===member.id).messagesSent,1,'Produtividade não conta mensagens privadas de outro setor');
    const privateMessage = await prisma.message.findFirstOrThrow({ where: { conversationId: conversation.id, text: `segredo-${tag}` } });
    await assert.rejects(() => inbox.assertCanViewMessage({ ...viewer }, privateMessage.id), { statusCode: 403 });
  } finally {
    if (contact) await prisma.contact.delete({ where: { id: contact.id } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
    await prisma.category.deleteMany({ where: { id: { in: categories.map(category => category.id) } } });
  }
});
test.after(() => prisma.$disconnect());
