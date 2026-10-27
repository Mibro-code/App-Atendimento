import {NextRequest,NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {requireSession,forbidden,badRequest} from '@/lib/api-auth';
import {getCustomerScopeFilter} from '@/lib/authz';
import {centralContactSource,contactLinkKey} from '@/lib/central-contact-source';
import {logAudit} from '@/lib/audit';
export async function POST(req:NextRequest){
  const {user,error}=await requireSession();if(error)return error;
  const body=await req.json().catch(()=>null);
  if(body?.confirm!==true||!['conversationId','customerId'].every(key=>typeof body[key]==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(body[key])))return badRequest('Confirme a conversa e o cadastro a vincular.');
  let source;
  try{source=await centralContactSource(req,user,body.conversationId);}catch{return forbidden('Você não pode vincular este atendimento.');}
  const customer=await prisma.customer.findFirst({where:{AND:[await getCustomerScopeFilter(user),{id:body.customerId}]},select:{id:true}});
  if(!customer)return forbidden('Cadastro indisponível no seu acesso.');
  const key=contactLinkKey(source);
  try{
    // Never overwrite an existing link, including concurrent requests.
    await prisma.centralContactLink.create({data:{...key,customerId:customer.id,confirmedBy:user.id}});
  }catch(e){
    if((e as {code?:string}).code!=='P2002')throw e;
    const existing=await prisma.centralContactLink.findUnique({where:{attendanceCompanyId_attendanceContactId:key},select:{customerId:true}});
    if(existing?.customerId!==customer.id)return NextResponse.json({error:'Este contato já está vinculado. Nenhum vínculo foi substituído.'},{status:409});
    return NextResponse.json({linked:true},{headers:{'Cache-Control':'no-store'}});
  }
  await logAudit({actorId:user.id,action:'CENTRAL_CONTACT_LINKED',entityType:'Customer',entityId:customer.id,metadata:key});
  return NextResponse.json({linked:true},{headers:{'Cache-Control':'no-store'}});
}
