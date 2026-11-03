const test = require('node:test');
const assert = require('node:assert/strict');
const { createBusinessClock, defaultCalendar, calendarFor } = require('../src/services/report-business-time-service');
const { computeConversationMetrics, computeCohortMetrics } = require('../src/services/conversation-analytics-service');
const date = value => new Date(value);
const clock = (a,b,cal=defaultCalendar) => createBusinessClock(date(a),date(b),cal)(date(a),date(b));

test('desconta noite, fim de semana e feriado; preserva segundos e limites', () => {
  assert.equal(clock('2026-10-08T19:30:00Z','2026-10-09T11:30:00Z'),3600);
  assert.equal(clock('2026-10-09T19:00:00Z','2026-10-12T12:00:00Z'),7200);
  const holiday = {...defaultCalendar,holidays:[{date:'2026-10-12',enabled:true}]};
  assert.equal(clock('2026-10-09T19:00:00Z','2026-10-13T12:00:00Z',holiday),7200);
  assert.equal(clock('2026-10-08T20:00:00Z','2026-10-09T11:00:00Z'),0);
  assert.equal(clock('2026-10-09T11:00:00.100Z','2026-10-09T11:00:30.600Z'),30.5);
  assert.equal(clock('2026-10-09T19:59:30Z','2026-10-09T20:00:30Z'),30);
  assert.equal(clock('2026-10-09T19:00:00Z','2026-10-09T18:00:00Z'),0);
});

test('calendário alterado, dias fechados, feriado desabilitado e fuso com DST', () => {
  const cal = {...defaultCalendar, schedules:[{dayOfWeek:5, enabled:true, startTime:'10:30',endTime:'12:15'}],holidays:[{date:'2026-10-09',enabled:false}]};
  assert.equal(clock('2026-10-09T11:00:00Z','2026-10-09T20:00:00Z',cal),6300);
  assert.equal(clock('2026-10-08T11:00:00Z','2026-10-08T20:00:00Z',cal),0);
  assert.equal(clock('2026-03-06T21:00:00Z','2026-03-09T13:00:00Z',{...defaultCalendar,timezone:'America/New_York'}),7200);
  assert.equal(clock('2026-10-09T11:00:00Z','2026-10-09T20:00:00Z',{...cal,schedules:cal.schedules.map(s=>({...s,enabled:false}))}),0);
});

test('primeira resposta/respostas/resolução usam expediente; bot e ausência de resposta preservados', () => {
  const conversation={createdAt:date('2026-10-09T19:00:00Z'),finalizedAt:date('2026-10-12T12:00:00Z'),status:'FINALIZADO'};
  const messages=[
    {direction:'RECEBIDA',occurredAt:conversation.createdAt},
    {direction:'ENVIADA',sentByUserId:null,occurredAt:date('2026-10-09T19:00:05Z')},
    {direction:'ENVIADA',sentByUserId:'human',occurredAt:conversation.finalizedAt},
  ];
  const metrics=computeConversationMetrics(messages,conversation);
  assert.equal(metrics.firstResponseSeconds,7200);
  assert.equal(metrics.responses[0].seconds,7200);
  assert.equal(metrics.resolutionSeconds,7200);
  assert.equal(computeConversationMetrics(messages.slice(0,2),conversation).firstResponseSeconds,null);
});

test('calendários por empresa e número; bot comercial sem horários herda triagem', async () => {
  const primary={...defaultCalendar,id:'primary',companyId:'a',type:'SYSTEM_TRIAGE',featureFlags:{}};
  const specific={...primary,id:'specific',type:'STANDARD',featureFlags:{channelAccountIds:['commercial']},schedules:[]};
  const foreign={...primary,id:'foreign',companyId:'b',schedules:[]};
  assert.equal(calendarFor({companyId:'a',channelAccountId:'commercial'},[foreign,primary,specific]).id,'primary');
  specific.schedules=[{dayOfWeek:5,enabled:true,startTime:'10:00',endTime:'11:00'}];
  assert.equal(calendarFor({companyId:'a',channelAccountId:'commercial'},[foreign,primary,specific]).id,'specific');
  const c={id:'c',companyId:'a',channelAccountId:'commercial',createdAt:date('2026-10-09T11:00:00Z'),finalizedAt:date('2026-10-09T20:00:00Z'),status:'FINALIZADO'};
  const client={conversationActivity:{groupBy:async()=>[]},message:{findMany:async()=>[]},bot:{findMany:async query=>{assert.deepEqual(query.where.companyId.in,['a']);return[primary,specific]}}};
  const result=await computeCohortMetrics([c],client);
  assert.equal(result.metricsById.get('c').resolutionSeconds,3600);
});
