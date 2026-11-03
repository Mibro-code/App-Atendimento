const {loadSlaCalendars}=require('./service-hours-sla');
const {noticeText,claimId,boundedSend}=require('./outside-hours-reception-service');
const {closedPeriod}=require('./assistant-runtime-calendar');

async function sendPreferredReception({db,conversation,targetId,message,send,settings,now=new Date(),closedOnly=false,isOptedOut,assertWindow}){
  const hours=(await loadSlaCalendars(db,now,[conversation.companyId])).get(conversation.companyId);
  const closed=!hours.availability.open;
  if(!closed&&closedOnly)return false;
  let text=String(settings.preferredAssigneeRoutingMessage||'').trim(),marker=null;
  if(closed){
    const next=closedPeriod({bot:hours.source,triage:hours.source,holidays:hours.holidays,availability:hours.availability},now);
    if(!next)return true; // no safe reopening known: never promise immediate help
    text=noticeText(hours.source,conversation,hours.availability.holiday);
    text+=`\n\nO atendimento será retomado em ${new Intl.DateTimeFormat('pt-BR',{timeZone:hours.source.timezone||'America/Sao_Paulo',weekday:'long',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(next))}. Seu atendimento permanece com o responsável e continuará no próximo expediente.`;
    marker=claimId(conversation.companyId,conversation.id,`preferred:${next}`);
  }
  if(!text||await isOptedOut())return true;
  await assertWindow(now);
  if(marker){
    const claimed=await db.$transaction(async tx=>{
      const fresh=await tx.conversation.findUnique({where:{id:conversation.id},include:{contact:true}});
      if(!fresh||fresh.archivedAt||fresh.companyId!==conversation.companyId||fresh.channelAccountId!==conversation.channelAccountId||fresh.status!=='AGUARDANDO_EQUIPE'||fresh.categoryId!==conversation.categoryId||fresh.assignedUserId!==targetId||!fresh.contact.preferredAssigneeEnabled||fresh.contact.preferredAssigneeId!==targetId)return false;
      const lock=await tx.conversation.updateMany({where:{id:fresh.id,updatedAt:fresh.updatedAt,archivedAt:null,assignedUserId:targetId,status:'AGUARDANDO_EQUIPE',categoryId:conversation.categoryId},data:{status:fresh.status}});
      if(!lock.count)return false;
      const row=await tx.conversationActivity.createMany({data:[{id:marker,conversationId:conversation.id,action:'PREFERRED_ASSIGNEE_OUTSIDE_HOURS',details:{state:'CLAIMED',inboundId:message.id,nextOpening:hours.availability.date}}],skipDuplicates:true});
      return row.count===1;
    });
    if(!claimed)return true;
  }
  // A timeout is ambiguous; the durable claim stays and is never retried.
  const result=await boundedSend(()=>send(text));
  const occurredAt=new Date();
  await db.message.create({data:{conversationId:conversation.id,channel:conversation.channel,channelAccountId:conversation.channelAccountId||null,externalId:result?.externalId||null,direction:'ENVIADA',status:'ENVIADA',type:'text',text,occurredAt,rawPayload:{message:result?.data||null,system:'preferred_assignee_routing',flowHandoff:true,outsideHours:closed}}});
  // Keep the customer's timestamp: the automatic receipt is not a human response.
  if(marker)await db.conversationActivity.update({where:{id:marker},data:{details:{state:'SENT',inboundId:message.id}}});
  return true;
}
module.exports={sendPreferredReception};
