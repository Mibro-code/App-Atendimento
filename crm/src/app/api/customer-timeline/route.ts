import {NextRequest,NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {requireSession,forbidden,badRequest} from '@/lib/api-auth';
import {getCustomerScopeFilter} from '@/lib/authz';
import {getAppointmentScopeFilter} from '@/lib/agenda';
import {centralSession} from '@/lib/central-session';
import {centralRequest} from '@/lib/central-identity';
import type {CommercialBrand} from '@prisma/client';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:NextRequest){
 const {user,error}=await requireSession();if(error)return error;
 const context=await centralSession(req,user);if(!context)return forbidden();
 const customerId=req.nextUrl.searchParams.get('customerId'),companyId=req.nextUrl.searchParams.get('companyId');
 if(!customerId||!companyId)return badRequest('Selecione o cadastro e a empresa.');
 const customer=await prisma.customer.findFirst({where:{AND:[await getCustomerScopeFilter(user),{id:customerId}]},select:{phoneDigits:true,phone2Digits:true,phone3Digits:true}});if(!customer)return json({error:'Cadastro indisponível.'},404);
 try{
  const options=await centralRequest<{companies:{id:string;slug:string}[]}>('/identity/conversation-options',context),company=options.companies.find(row=>row.id===companyId);if(!company)return forbidden();
  const brand=({mibro:'MIBRO',sincrofit:'SINCROFIT'} as Record<string,CommercialBrand>)[company.slug];
  const [messages,activities,quotes,sales,appointments]=await Promise.all([
   centralRequest<{events:{id:string;at:string;source:string;label:string}[]}>('/identity/customer-timeline',{...context,companyId,customerId,phones:[customer.phoneDigits,customer.phone2Digits,customer.phone3Digits].filter(Boolean)}),
   prisma.customerActivity.findMany({where:{customerId},take:20,orderBy:{createdAt:'desc'},select:{id:true,createdAt:true,type:true,description:true}}),
   brand?prisma.quote.findMany({where:{customerId,brand,deletedAt:null},take:10,orderBy:{createdAt:'desc'},select:{id:true,createdAt:true,status:true}}):[],
   brand?prisma.sale.findMany({where:{customerId,olistOrder:{is:{brand}}},take:10,orderBy:{createdAt:'desc'},select:{id:true,confirmedAt:true,createdAt:true,stage:true}}):[],
   prisma.appointment.findMany({where:{AND:[{customerId},await getAppointmentScopeFilter(user)]},take:10,orderBy:{startsAt:'desc'},select:{id:true,startsAt:true,title:true,status:true}})
  ]);
  const events=[...messages.events,...activities.map(row=>({id:'activity-'+row.id,at:row.createdAt.toISOString(),source:'CRM · cadastro compartilhado',label:`${row.type} · ${row.description}`})),...quotes.map(row=>({id:'quote-'+row.id,at:row.createdAt.toISOString(),source:'Proposta · empresa selecionada',label:`Proposta #${row.id.slice(-6)} · ${row.status}`})),...sales.map(row=>({id:'sale-'+row.id,at:(row.confirmedAt||row.createdAt).toISOString(),source:'Venda · pedido vinculado ao Olist',label:row.stage})),...appointments.map(row=>({id:'appointment-'+row.id,at:row.startsAt.toISOString(),source:'CRM · agenda permitida',label:`${row.title} · ${row.status}`}))].sort((a,b)=>new Date(b.at).getTime()-new Date(a.at).getTime()).slice(0,50);
  return json({events});
 }catch{return json({error:'Não foi possível consultar a linha do tempo. Tente novamente.'},503);}
}
