const fail=(message,statusCode=409)=>Object.assign(new Error(message),{statusCode});
// Explicit dependency injection allows offline tests. No module-level DB access.
async function setArchived(db,authorization,viewer,id,archived,{now=new Date()}={}){
 if(typeof archived!=='boolean')throw fail('Informe arquivada: sim ou não.',400);
 await authorization.assertCanActOnConversation(viewer,id,{allowArchived:true});
 const scope=await authorization.operationalScope(viewer);
 try{return await db.$transaction(async tx=>{
  const row=await tx.conversation.findFirst({where:{AND:[{id},scope]},select:{id:true,companyId:true,archivedAt:true,updatedAt:true,status:true}});
  if(!row)throw fail('Conversa não disponível no seu acesso.',404);
  if(Boolean(row.archivedAt)===archived)return{id,archivedAt:row.archivedAt,unchanged:true};
  if(archived&&await tx.botFlowExecution.findFirst({where:{conversationId:id,status:'RUNNING'},select:{id:true}}))throw fail('O bot está respondendo. Aguarde a conclusão e tente arquivar novamente.');
  const changed=await tx.conversation.updateMany({where:{id,updatedAt:row.updatedAt,archivedAt:row.archivedAt},data:{archivedAt:archived?now:null,archivedByUserId:archived?viewer.id:null,...(archived&&row.status==='BOT'?{status:'NOVO'}:{})}});
  if(!changed.count)throw fail('A conversa mudou. Atualize antes de arquivar ou recuperar.');
  if(archived)await tx.botFlowExecution.updateMany({where:{conversationId:id,status:{in:['WAITING_CUSTOMER','WAITING_TIMER']}},data:{status:'HANDED_OFF',finishedAt:now,resumeAt:null,error:'CONVERSATION_ARCHIVED',step:{increment:1}}});
  const action=archived?'CONVERSATION_ARCHIVED':'CONVERSATION_RESTORED';
  const details={source:'MANUAL',previousStatus:row.status,historyPreserved:true};
  await tx.conversationActivity.create({data:{conversationId:id,actorUserId:viewer.id,action,details}});
  await tx.auditLog.create({data:{actorUserId:viewer.id,actorName:viewer.name,companyId:row.companyId,action,entityType:'CONVERSATION',entityId:id,summary:archived?'Conversa arquivada sem exclusão de histórico':'Conversa recuperada do arquivo',details:{conversationId:id,companyId:row.companyId,...details}}});
  return{id,companyId:row.companyId,archivedAt:archived?now:null};
 },{isolationLevel:'Serializable',timeout:10000});}catch(error){if(error.code==='P2034')throw fail('Outra pessoa alterou a conversa. Atualize e tente novamente.');throw error;}
}
module.exports={setArchived};
