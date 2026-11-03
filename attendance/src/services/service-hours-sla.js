// Shared live SLA clock. No persisted timer, per-conversation queries or writes.
const calendar = require('./business-hours-service');
const { assistantCalendar } = require('./assistant-business-policy');
const { defaultCalendar } = require('./report-business-time-service');
const fallback = companyId => ({ ...defaultCalendar, id:'default', companyId, type:'SYSTEM_TRIAGE' });
function createSlaCalendar(bot, holidays, now) {
  const source = bot?.schedules?.length ? bot : fallback(bot?.companyId);
  const availability = assistantCalendar({bot:source,triage:source,companyId:source.companyId,now,holidays});
  const intervals=[];
  let compiledCap=-1;
  // Only a duration up to the configured SLA is needed. Stop after the cap,
  // rather than iterating through years for an old unattended conversation.
  function elapsed(since, cap) {
    if(!availability.open)return null;
    const from=Number(new Date(since)),end=Number(now);
    if(!Number.isFinite(from)||from>=end)return 0;
    if(compiledCap<cap){
      intervals.length=0;
      let covered=0;
      for(let offset=0;offset<3660&&covered<=cap+1;offset++){
        const date=calendar.addDaysToDate(availability.date,-offset);
        const midday=calendar.zonedInstant(date,'12:00',source.timezone);
        const state=assistantCalendar({bot:source,triage:source,companyId:source.companyId,now:midday,holidays});
        const schedule=source.schedules.find(s=>s.dayOfWeek===state.dayOfWeek);
        if(state.holiday?state.holiday.allDay!==false:!schedule?.enabled)continue;
        const a=Number(calendar.zonedInstant(date,state.holiday?state.holiday.openTime:schedule.startTime,source.timezone));
        const b=Math.min(end,Number(calendar.zonedInstant(date,state.holiday?state.holiday.closeTime:schedule.endTime,source.timezone)));
        if(b>a){intervals.push([a,b]);covered+=(b-a)/60000;}
      }
      compiledCap=cap;
    }
    let total=0;
    for(const [a,b] of intervals){if(b<=from)break;total+=Math.max(0,b-Math.max(a,from))/60000;if(total>cap)return cap+1;}
    return total;
  }
  function cutoff(minutes){
    if(!availability.open)return null;
    elapsed(new Date(0),minutes);
    let remaining=minutes;
    for(const [a,b]of intervals){const duration=(b-a)/60000;if(remaining<=duration)return new Date(b-remaining*60000);remaining-=duration;}
    return null;
  }
  return {source,holidays,availability,elapsed,cutoff};
}
async function loadSlaCalendars(db,now,companyIds) {
  const ids=companyIds?[...new Set(companyIds)].filter(Boolean):null;
  if(ids&&!ids.length)return new Map();
  const [bots,holidays]=await Promise.all([
    db.bot.findMany({where:{type:'SYSTEM_TRIAGE',archivedAt:null,status:{not:'ARCHIVED_LEGACY'},...(ids?{companyId:{in:ids}}:{})},orderBy:[{createdAt:'asc'},{id:'asc'}],include:{schedules:true,holidays:true}}),
    db.businessHoliday.findMany({where:ids?{scopeKey:{in:['GLOBAL',...ids]}}:{}}),
  ]);
  const map=new Map();
  for(const id of ids||[...new Set(bots.map(b=>b.companyId))])map.set(id,createSlaCalendar(bots.find(b=>b.companyId===id)||fallback(id),holidays,now));
  return map;
}
async function attachSlaCalendars(settings,db,now){
  const contexts=await loadSlaCalendars(db,now,[...settings.keys()]);
  for(const [id,value]of settings)settings.set(id,{...value,_slaCalendar:contexts.get(id)});
}
function slaMinutesRemaining(conversation,settings,now){
  if(!settings||conversation.archivedAt||conversation.channel==='EMAIL')return null;
  let limit;
  if(conversation.status==='NOVO'&&settings.firstResponseSlaEnabled)limit=settings.firstResponseSlaMinutes;
  if(['AGUARDANDO_EQUIPE','HANDOFF_BOT'].includes(conversation.status)&&settings.responseSlaEnabled)limit=settings.responseSlaMinutes;
  if(!limit)return null;
  const context=settings._slaCalendar||createSlaCalendar(fallback(conversation.companyId||'default'),[],now);
  const cap=Math.max(settings.firstResponseSlaMinutes||0,settings.responseSlaMinutes||0,limit);
  const elapsed=context.elapsed(conversation.lastMessageAt||conversation.createdAt,cap);
  return elapsed===null?null:limit-elapsed;
}
function slaOverdueWhere(settings,context){
  const clauses=[];
  for(const [enabled,minutes,status]of [[settings.firstResponseSlaEnabled,settings.firstResponseSlaMinutes,'NOVO'],[settings.responseSlaEnabled,settings.responseSlaMinutes,{in:['AGUARDANDO_EQUIPE','HANDOFF_BOT']}]]){
    const cutoff=enabled&&context.cutoff(minutes);
    if(cutoff)clauses.push({status,lastMessageAt:{lt:cutoff}});
  }
  return {OR:clauses};
}
module.exports={createSlaCalendar,loadSlaCalendars,attachSlaCalendars,slaMinutesRemaining,slaOverdueWhere};
