import {NextRequest,NextResponse} from 'next/server';
import type {CommercialBrand,Prisma} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {requireSession,forbidden,badRequest} from '@/lib/api-auth';
import {getCustomerScopeFilter} from '@/lib/authz';
import {centralSession} from '@/lib/central-session';
import {centralRequest,identityOrigins} from '@/lib/central-identity';
import {myAppointmentsFilter} from '@/lib/agenda';
type Item={id:string;label:string;detail?:string;href:string;at?:string};
export async function GET(req:NextRequest){
  const {user,error}=await requireSession();if(error)return error;
  const context=await centralSession(req,user);if(!context)return forbidden();
  const mode=req.nextUrl.searchParams.get('mode'),company=req.nextUrl.searchParams.get('company')||'',q=(req.nextUrl.searchParams.get('q')||'').trim().slice(0,100);
  if(!['mibro','sincrofit'].includes(company)||!['search','notifications'].includes(mode||''))return badRequest('Selecione empresa e consulta.');
  const brand=company.toUpperCase() as CommercialBrand,scope=await getCustomerScopeFilter(user);
  const origins=identityOrigins();
  const crmHref=(params:Record<string,string>)=>new URL('/crm?'+new URLSearchParams({connect:'1',...params}),origins.attendance).href;
  try{
    // Check the source company before any CRM result can be returned.
    const attendance=await centralRequest<{alerts?:{id:string;title:string;conversationId:string;createdAt:string}[];conversations?:{id:string;name:string;status:string;number:string}[]}>('/identity/workspace-center',{...context,company,mode,q});
    const groups:{title:string;items:Item[]}[]=[];
    if(mode==='search'){
      if(q.length<2)return NextResponse.json({groups},{headers:{'Cache-Control':'no-store'}});
      const digits=q.replace(/\D/g,'');
      const customerSearch:Prisma.CustomerWhereInput={OR:[{contactName:{contains:q,mode:'insensitive'}},{tradeName:{contains:q,mode:'insensitive'}},{legalName:{contains:q,mode:'insensitive'}},...(digits.length>=4?[{phoneDigits:{contains:digits}},{phone2Digits:{contains:digits}},{phone3Digits:{contains:digits}}]:[])]};
      const [customers,quotes,orders]=await Promise.all([
        prisma.customer.findMany({where:{AND:[scope,customerSearch]},select:{id:true,contactName:true,tradeName:true},orderBy:{updatedAt:'desc'},take:8}),
        prisma.quote.findMany({where:{brand,deletedAt:null,customer:{is:scope},OR:[{id:q},{customer:{is:customerSearch}}]},select:{id:true,status:true,customer:{select:{contactName:true}}},orderBy:{createdAt:'desc'},take:8}),
        prisma.olistOrder.findMany({where:{brand,customer:{is:scope},OR:[{orderNumber:{contains:q,mode:'insensitive'}},{customer:{is:customerSearch}}]},select:{id:true,orderNumber:true,crmStatus:true,customerId:true,customer:{select:{contactName:true}}},orderBy:{updatedAt:'desc'},take:8}),
      ]);
      groups.push({title:'Conversas · '+company,items:(attendance.conversations||[]).map(row=>({id:'attendance:'+row.id,label:row.name,detail:row.number+' · '+row.status,href:new URL('/identity/start?conversation='+encodeURIComponent(row.id),origins.attendance).href}))},
        {title:'Clientes · carteira do CRM',items:customers.map(row=>({id:'customer:'+row.id,label:row.tradeName||row.contactName,href:crmHref({customer:row.id})}))},
        {title:'Propostas · '+company,items:quotes.map(row=>({id:'quote:'+row.id,label:row.customer.contactName,detail:row.status,href:crmHref({quote:row.id})}))},
        {title:'Pedidos Olist · '+company,items:orders.map(row=>({id:'order:'+row.id,label:row.orderNumber||'Pedido',detail:row.customer.contactName+' · '+row.crmStatus,href:crmHref({customer:row.customerId})}))});
    }else{
      const now=new Date(),recent=new Date(Date.now()-7*86400000);
      const [notifications,appointments,followUps,orders]=await Promise.all([
        prisma.notification.findMany({where:{recipientId:user.id,readAt:null,OR:[{quoteId:null},{quote:{is:{brand,deletedAt:null,customer:{is:scope}}}}]},select:{id:true,title:true,createdAt:true,quoteId:true},orderBy:{createdAt:'desc'},take:20}),
        prisma.appointment.findMany({where:{AND:[myAppointmentsFilter(user.id),{status:'PENDENTE',startsAt:{lte:now},OR:[{customerId:null},{customer:{is:scope}}]}]},select:{id:true,title:true,startsAt:true,customerId:true},orderBy:{startsAt:'asc'},take:10}),
        prisma.followUp.findMany({where:{sellerId:user.id,status:'PENDENTE',dueAt:{lte:now},customer:{is:scope}},select:{id:true,dueAt:true,customerId:true,customer:{select:{contactName:true}}},orderBy:{dueAt:'asc'},take:10}),
        prisma.olistStatusHistory.findMany({where:{createdAt:{gte:recent},olistOrder:{is:{brand,customer:{is:scope}}}},select:{id:true,createdAt:true,crmStatus:true,olistOrder:{select:{customerId:true,orderNumber:true}}},orderBy:{createdAt:'desc'},take:10}),
      ]);
      groups.push({title:'Atendimento · últimas 24 horas',items:(attendance.alerts||[]).map(row=>({id:'attendance:'+row.id,label:row.title,at:row.createdAt,href:new URL('/identity/start?conversation='+encodeURIComponent(row.conversationId),origins.attendance).href}))},
        {title:'Avisos do CRM',items:notifications.map(row=>({id:'notification:'+row.id,label:row.title,at:row.createdAt.toISOString(),href:row.quoteId?crmHref({quote:row.quoteId}):new URL('/crm',origins.attendance).href}))},
        {title:'Retornos e compromissos pendentes',items:[...appointments.map(row=>({id:'appointment:'+row.id,label:row.title,at:row.startsAt.toISOString(),href:row.customerId?crmHref({customer:row.customerId}):new URL('/crm',origins.attendance).href})),...followUps.map(row=>({id:'followup:'+row.id,label:'Retorno · '+row.customer.contactName,at:row.dueAt.toISOString(),href:crmHref({customer:row.customerId})}))]},
        {title:'Atualizações Olist · últimos 7 dias',items:orders.map(row=>({id:'olist:'+row.id,label:'Pedido '+(row.olistOrder.orderNumber||''),detail:row.crmStatus,at:row.createdAt.toISOString(),href:crmHref({customer:row.olistOrder.customerId})}))});
    }
    return NextResponse.json({groups},{headers:{'Cache-Control':'no-store'}});
  }catch{return NextResponse.json({error:'Consulta indisponível ou empresa fora do seu acesso. Tente atualizar.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
