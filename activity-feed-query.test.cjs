const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function load(file, dependencies) {
 const module = { exports: {} };
 vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { module, exports: module.exports, Date, Intl, console, require: name => { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw Error('Unexpected dependency ' + name); } }, { filename: file });
 return module.exports;
}
const time = load('attendance/src/services/operation-time.js', {});
function services() {
 const calls = [];
 const service = load('attendance/src/services/follow-up-service.js', {
  '../database/prisma': { followUp: { findMany: async query => { calls.push({ type: 'list', query }); return []; }, count: async query => { calls.push({ type: 'count', query }); return 0; } } },
  './authorization-service': {}, './company-service': { resolveCompanyFilter: async () => ['cmp_mibro'], companyAccess: async () => [{ companyId: 'cmp_mibro', role: 'ADMIN' }] },
  './private-segment-service': { readablePrivateCategoryIds: async () => [] }, './audit-service': {}, './operation-time': time,
 });
 return { calls, service, feed: load('attendance/src/services/activity-feed-service.js', { './follow-up-service': service, './operation-time': time }) };
}
const user = { id: 'synthetic-master', role: 'ADMIN' }, now = new Date('2026-10-21T13:00:00Z');
test('activity feed uses 2 lists and only its 2 needed counts, preserving scope', async () => {
 const { calls, feed } = services();
 const result = await feed.feed(user, { company: 'mibro' }, { now });
 assert.equal(calls.filter(c => c.type === 'list').length, 2);
 assert.equal(calls.filter(c => c.type === 'count').length, 2);
 assert.ok(calls.every(c => JSON.stringify(c.query).includes('cmp_mibro')));
 assert.ok(calls.every(c => JSON.stringify(c.query).includes('synthetic-master')));
 assert.equal(result.items.length, 0);
 const done = calls.find(c => c.type === 'list' && JSON.stringify(c.query).includes('CONCLUIDO'));
 assert.ok(JSON.stringify(done.query).includes('2026-10-14T13:00:00.000Z'));
});
test('ordinary Agenda callers keep all 7 counters and the same default contract', async () => {
 const { calls, service } = services();
 const result = await service.listFollowUps(user, { company: 'mibro' }, { now });
 assert.equal(calls.filter(c => c.type === 'count').length, 7);
 assert.deepEqual(Object.keys(result.counts), ['OVERDUE', 'TODAY', 'TOMORROW', 'WEEK', 'UPCOMING', 'DONE', 'CANCELLED']);
});
