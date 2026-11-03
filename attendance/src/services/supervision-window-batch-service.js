// Same supervision windows as assignment-period-service.supervisionWindows,
// batched per authorized request. No shared cache and no permission changes.
const {mergeWindows}=require('./assignment-period-service');
async function supervisionWindowsMany(conversations,userIds,client){
 const result=new Map(conversations.map(c=>[c.id,[]]));
 if(!conversations.length||!userIds.length)return result;
 const ids=conversations.map(c=>c.id),grouped=new Map(ids.map(id=>[id,[]]));
 const periods=await client.conversationAssignmentPeriod.findMany({where:{conversationId:{in:ids},userId:{in:userIds}},select:{conversationId:true,userId:true,startedAt:true,endedAt:true}});
 for(const period of periods)grouped.get(period.conversationId)?.push(period);
 const missing=conversations.filter(c=>c.assignedUserId&&userIds.includes(c.assignedUserId)&&!grouped.get(c.id).some(p=>p.userId===c.assignedUserId&&!p.endedAt));
 const lastByConversation=new Map();
 if(missing.length){
  const targets=new Map(missing.map(c=>[c.id,c.assignedUserId]));
  const activities=await client.conversationActivity.findMany({where:{conversationId:{in:missing.map(c=>c.id)},action:{in:['CONVERSATION_CLAIMED','CONVERSATION_TRANSFERRED']},OR:[...new Set(missing.map(c=>c.assignedUserId))].map(id=>({details:{path:['toUserId'],equals:id}}))},orderBy:{createdAt:'desc'},select:{conversationId:true,createdAt:true,details:true}});
  for(const activity of activities)if(!lastByConversation.has(activity.conversationId)&&activity.details?.toUserId===targets.get(activity.conversationId))lastByConversation.set(activity.conversationId,activity.createdAt);
 }
 const missingIds=new Set(missing.map(c=>c.id));
 for(const c of conversations){const windows=grouped.get(c.id).map(p=>({from:p.startedAt,to:p.endedAt}));if(missingIds.has(c.id))windows.push({from:lastByConversation.get(c.id)||null,to:null});result.set(c.id,mergeWindows(windows));}
 return result;
}
module.exports={supervisionWindowsMany};
