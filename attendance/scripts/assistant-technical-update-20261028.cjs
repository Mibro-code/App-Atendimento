// Explicit publication step for the reviewed release. Importing never writes.
const crypto=require('node:crypto');
const {technicalAssistanceGraph}=require('../src/services/technical-assistance-sequence');
const {validateGraph}=require('../src/services/bot-visual-flow-graph');
const FLOW='asst_20261027_technical',BOT='mibro-assistant-observer';
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function prepare(db){
 const bot=await db.bot.findUnique({where:{id:BOT},select:{id:true,companyId:true,status:true,autoReplyEnabled:true,archivedAt:true,featureFlags:true,updatedAt:true}});
 const flow=await db.botFlow.findUnique({where:{id:FLOW},include:{activeVersion:true}});
 if(!bot||bot.archivedAt||!flow||flow.botId!==BOT||!flow.activeVersion||!flow.activeVersion.graph.nodes.some(n=>n.key==='tech_intake_documents'))throw Error('Unexpected technical flow baseline');
 const existingKeys=flow.activeVersion.graph.nodes.map(n=>n.key).sort();
 if(hash(flow.activeVersion.graph)!==hash(technicalAssistanceGraph())&&JSON.stringify(existingKeys)!==JSON.stringify(['human','start','tech_intake_documents']))throw Error('Custom published technical flow requires a reviewed merge');
 const graph=technicalAssistanceGraph();if(!validateGraph(graph).valid)throw Error('Invalid technical sequence');
 return{bot,flowId:FLOW,flowUpdatedAt:flow.updatedAt,activeVersionId:flow.activeVersionId,activeGraphHash:hash(flow.activeVersion.graph),draftGraphHash:hash(flow.draftGraph),graph};
}
async function install(db,expected){return db.$transaction(async tx=>{
 await tx.$queryRaw`SELECT id FROM "BotFlow" WHERE id=${FLOW} FOR UPDATE`;
 const current=await prepare(tx);if(hash(current)!==hash(expected))throw Error('Technical flow or bot changed since preflight');
 if(current.activeGraphHash===hash(current.graph))throw Error('Technical sequence already published');
 const max=await tx.botFlowVersion.aggregate({where:{flowId:FLOW},_max:{version:true}}),version=(max._max.version||0)+1;
 const published=await tx.botFlowVersion.create({data:{flowId:FLOW,version,graph:current.graph,label:'Assistência técnica — coleta de detalhes 28/10/2026',publishedByName:'Atualização revisada da assistência'}});
 const canUpdateDraft=current.draftGraphHash===current.activeGraphHash;
 await tx.botFlow.update({where:{id:FLOW,updatedAt:new Date(current.flowUpdatedAt)},data:{activeVersionId:published.id,...(canUpdateDraft?{draftGraph:current.graph}:{})}});
 return{flowId:FLOW,version,previousVersionId:current.activeVersionId,botStatusUnchanged:current.bot.status,autoReplyUnchanged:current.bot.autoReplyEnabled,operatorDraftPreserved:!canUpdateDraft,existingExecutionsUnchanged:true};
},{timeout:15000});}
module.exports={prepare,install};
