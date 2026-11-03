import {NextRequest,NextResponse} from 'next/server';

import {prisma} from '@/lib/prisma';
import {requireSession,forbidden,badRequest} from '@/lib/api-auth';
import {getCustomerScopeFilter} from '@/lib/authz';
import {centralSession} from '@/lib/central-session';
import {centralRequest,identityOrigins} from '@/lib/central-identity';
import {PIPELINE_STAGE_META} from '@/lib/pipeline-rules';

const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
const validId=(v:string|null)=>v!==null&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
// CRM stores national and international digits. Match exact variants only,
// never suffix/contains, and never infer company ownership from interestedBrand.
function phoneVariants(values:string[]){
  return [...new Set(values.flatMap(value=>{
    let phone=value.replace(/\D/g,'');
    if(phone.length===10||phone.length===11)phone='55'+phone;
    if(!/^\d{10,15}$/.test(phone))return [];
    const list=[phone],withNine=phone.match(/^55(\d{2})9([6-9]\d{7})$/),withoutNine=phone.match(/^55(\d{2})([6-9]\d{7})$/);
    if(withNine)list.push(`55${withNine[1]}${withNine[2]}`);
    if(withoutNine)list.push(`55${withoutNine[1]}9${withoutNine[2]}`);
    return list.flatMap(p=>/^55\d{10,11}$/.test(p)?[p,p.slice(2)]:[p]);
  }))];
}
export async function GET(req:NextRequest){
  const {user,error}=await requireSession();if(error)return error;
  const context=await centralSession(req,user);if(!context)return forbidden('Acesso integrado indisponível para esta conta.');
  try{
    if(req.nextUrl.searchParams.get('options')==='1')return json(await centralRequest('/identity/conversation-options',context));
    const conversationId=req.nextUrl.searchParams.get('conversationId'),customerId=req.nextUrl.searchParams.get('customerId');
    const scope=await getCustomerScopeFilter(user);
    if(validId(conversationId)){
      const conversation=await centralRequest<{id:string;contactId:string;name:string;phones:string[];company:{id:string;name:string;slug:string}}>('/identity/conversation-context',{...context,conversationId,forImport:req.nextUrl.searchParams.get('import')==='1'});
      const link=await prisma.centralContactLink.findUnique({where:{attendanceCompanyId_attendanceContactId:{attendanceCompanyId:conversation.company.id,attendanceContactId:conversation.contactId}},select:{customerId:true}});
      const variants=phoneVariants(conversation.phones);
      const rows=link||variants.length?await prisma.customer.findMany({where:{AND:[scope,link?{id:link.customerId}:{OR:[{phoneDigits:{in:variants}},{phone2Digits:{in:variants}},{phone3Digits:{in:variants}}]}]},take:11,orderBy:{id:'asc'},select:{id:true,contactName:true,tradeName:true,email:true,city:true,state:true,pipelineStage:true,seller:{select:{name:true}},quotes:{where:{deletedAt:null},orderBy:{createdAt:'desc'},take:3,select:{id:true,status:true,totalValueCents:true,createdAt:true,brand:true}}}}):[];
      return json({company:conversation.company,linked:Boolean(link),lead:{name:conversation.name,phone:conversation.phones[0]||'',origin:`Atendimento · ${conversation.company.name}`},createHref:new URL(`/crm?connect=1&lead=${encodeURIComponent(conversationId!)}`,identityOrigins().attendance).href,ambiguous:rows.length>1,truncated:rows.length>10,customers:rows.slice(0,10).map(row=>({...row,stageLabel:PIPELINE_STAGE_META[row.pipelineStage].label,href:new URL(`/crm?connect=1&customer=${encodeURIComponent(row.id)}`,identityOrigins().attendance).href}))});
    }
    if(validId(customerId)){
      const companyId=req.nextUrl.searchParams.get('companyId');if(!validId(companyId))return badRequest('Selecione a empresa do atendimento.');
      const customer=await prisma.customer.findFirst({where:{AND:[scope,{id:customerId!}]},select:{phoneDigits:true,phone2Digits:true,phone3Digits:true,centralContactLinks:{where:{attendanceCompanyId:companyId!},take:20,select:{attendanceContactId:true}}}});
      if(!customer)return json({error:'Cadastro não disponível no seu acesso.'},404);
      const phones=[...new Set([customer.phoneDigits,customer.phone2Digits,customer.phone3Digits].filter((p):p is string=>Boolean(p)).map(p=>{const digits=p.replace(/\D/g,'');return digits.length===10||digits.length===11?'55'+digits:digits;}).filter(p=>/^\d{10,15}$/.test(p)))];
      const contactIds=customer.centralContactLinks.map(link=>link.attendanceContactId);
      if(!phones.length&&!contactIds.length)return json({conversations:[]});
      const result=await centralRequest<{conversations:{id:string;status:string;assignedUser:{name:string}|null;channelAccount:{name:string}|null;updatedAt:string}[]}>('/identity/customer-conversations',{...context,companyId,phones,contactIds});
      return json({conversations:result.conversations.map(row=>({...row,href:new URL(`/identity/start?conversation=${encodeURIComponent(row.id)}`,identityOrigins().attendance).href}))});
    }
    return badRequest('Selecione uma conversa ou um cadastro válido.');
  }catch(e){
    const code=(e as {statusCode?:number})?.statusCode;
    return json({error:code===403||code===404?'Conversa ou empresa não disponível no seu acesso.':'Não foi possível consultar agora. Tente novamente.'},code===403||code===404?404:503);
  }
}
