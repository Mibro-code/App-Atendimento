import {NextRequest,NextResponse} from 'next/server';
import {getToken} from 'next-auth/jwt';
import {z} from 'zod';
import {prisma} from '@/lib/prisma';
import {requireSession,badRequest,forbidden} from '@/lib/api-auth';
import {getCustomerScopeFilter,getVisibleSellerIds} from '@/lib/authz';
import {buildCustomerListWhere,parseCustomerListFilters,CustomerFilterForbiddenError} from '@/lib/customer-list';
import {centralEnabled,centralRequest,identityOrigins} from '@/lib/central-identity';

const phoneFields=['phoneDigits','phone2Digits','phone3Digits'] as const;
type PhoneField=typeof phoneFields[number];
const select={id:true,contactName:true,tradeName:true,phoneDigits:true,phone2Digits:true,phone3Digits:true,phoneChannel:true,phone2Channel:true,phone3Channel:true,city:true,state:true,seller:{select:{name:true}}} as const;
const usageField=(field:PhoneField)=>field==='phone2Digits'?'phone2Channel':field==='phone3Digits'?'phone3Channel':'phoneChannel';
export type ContactHistory={id:string;phone:string|null;hasSent:boolean;lastSentAt:string|null;lastEventAt:string|null;lastStatus:string|null;senderName:string|null;senderPhone:string|null;agentName:string|null;templateName:string|null;queued:boolean;failed:boolean;optedOut:boolean;crossCompany?:{contactedElsewhere:boolean;companies:string[];restrictedCompany:boolean}};
type Context={crmUserId:string;primaryProof:string};
async function bridgeContext(req:NextRequest,id:string,role:string):Promise<Context|null>{
  if(!centralEnabled()||role==='REPRESENTANTE')return null;
  const link=await prisma.centralIdentityLink.findUnique({where:{userId:id},select:{enabled:true}});
  if(!link?.enabled)return null;
  const token=await getToken({req,secret:process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET||'',secureCookie:identityOrigins().crm.startsWith('https:')});
  return token?.id===id&&typeof token.primaryProof==='string'?{crmUserId:id,primaryProof:token.primaryProof}:null;
}
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:NextRequest){
  const {user,error}=await requireSession();if(error)return error;
  const context=await bridgeContext(req,user.id,user.role);if(!context)return forbidden('É necessário vínculo com o Atendimento. Representantes não têm acesso a envios.');
  try{
    if(req.nextUrl.searchParams.get('options')==='1'){
      const visible=await getVisibleSellerIds(user);
      const [options,sellers]=await Promise.all([centralRequest<{companies:unknown[]}>('/identity/contact-options',context),prisma.user.findMany({where:{active:true,deletedAt:null,...(visible?{id:{in:visible}}:{})},select:{id:true,name:true},orderBy:{name:'asc'}})]);
      return json({...options,sellers});
    }
    const companyId=req.nextUrl.searchParams.get('companyId')||'';if(!companyId)return badRequest('Escolha a empresa do envio.');
    const field=(req.nextUrl.searchParams.get('phoneField')||'phoneDigits') as PhoneField;if(!phoneFields.includes(field))return badRequest('Telefone inválido.');
    const raw=Object.fromEntries(req.nextUrl.searchParams),filters=parseCustomerListFilters(raw),scope=await buildCustomerListWhere(user,filters);
    const page=Math.min(10000,Math.max(1,Number.parseInt(raw.page||'1',10)||1)),take=50;
    const where={AND:[scope,{[field]:{not:null}}]};
    const [total,contacts]=await Promise.all([prisma.customer.count({where}),prisma.customer.findMany({where,select,take,skip:(page-1)*take,orderBy:[{contactName:'asc'},{id:'asc'}]})]);
    const tracked=await centralRequest<{history:ContactHistory[]}>('/identity/contact-history',{...context,companyId,recipients:contacts.map(row=>({id:row.id,phone:row[field]}))});
    const byId=new Map(tracked.history.map(row=>[row.id,row]));
    return json({page,total,pageSize:take,contacts:contacts.map(row=>({id:row.id,name:row.tradeName||row.contactName,contactName:row.contactName,phone:row[field],whatsappAllowed:row[usageField(field)]!=='PHONE',city:row.city,state:row.state,seller:row.seller.name,history:byId.get(row.id)}))});
  }catch(e){return e instanceof CustomerFilterForbiddenError||(e as {statusCode?:number})?.statusCode===403?forbidden('Filtro ou empresa fora do seu acesso.'):json({error:'Não foi possível sincronizar o histórico. Nenhum contato foi enviado.'},503);}
}
const selection=z.object({companyId:z.string().min(1),ids:z.array(z.string().min(1)).min(1).max(500),phoneField:z.enum(phoneFields).default('phoneDigits'),skipSent:z.boolean().default(true)});
export async function POST(req:NextRequest){
  const {user,error}=await requireSession();if(error)return error;
  const context=await bridgeContext(req,user.id,user.role);if(!context)return forbidden('Sua conta não tem acesso a envios pela Central.');
  const parsed=selection.safeParse(await req.json().catch(()=>null));if(!parsed.success)return badRequest('Selecione a empresa e até 500 contatos válidos.');
  const {companyId,phoneField,skipSent}=parsed.data,ids=[...new Set(parsed.data.ids)];
  const scope=await getCustomerScopeFilter(user);
  const contacts=await prisma.customer.findMany({where:{AND:[scope,{id:{in:ids}}]},select});
  // Never accept client-supplied phone/name, and never export inaccessible IDs.
  if(contacts.length!==ids.length)return forbidden('Um ou mais contatos não pertencem à sua carteira atual. Atualize a lista.');
  if(contacts.some(row=>row[usageField(phoneField)]==='PHONE'))return badRequest('Há número marcado como somente telefone. Escolha um campo habilitado para WhatsApp.');
  try{return json(await centralRequest('/identity/contact-selection',{...context,companyId,skipSent,recipients:contacts.map(row=>({id:row.id,name:row.tradeName||row.contactName,phone:row[phoneField]}))}));}
  catch(e){return (e as {statusCode?:number})?.statusCode===403?forbidden('Você não pode enviar por esta empresa.'):json({error:'Não foi possível preparar a seleção. Verifique a empresa e suas permissões. Nenhuma mensagem foi enviada.'},503);}
}
