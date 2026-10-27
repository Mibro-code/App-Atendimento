import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {prisma} from '@/lib/prisma';
import {requireSession,forbidden,badRequest} from '@/lib/api-auth';
import {getCustomerScopeFilter} from '@/lib/authz';
import {centralSession} from '@/lib/central-session';
import {centralRequest} from '@/lib/central-identity';
const input=z.object({quoteId:z.string().min(1).max(128),phoneField:z.enum(['phoneDigits','phone2Digits','phone3Digits']).default('phoneDigits')});
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(req:NextRequest){
 const {user,error}=await requireSession();if(error)return error;
 const context=await centralSession(req,user);if(!context)return forbidden('Conta sem acesso integrado ao Atendimento.');
 const parsed=input.safeParse(await req.json().catch(()=>null));if(!parsed.success)return badRequest('Proposta ou telefone inválido.');
 const quote=await prisma.quote.findFirst({where:{id:parsed.data.quoteId,deletedAt:null,customer:{is:await getCustomerScopeFilter(user)}},select:{id:true,brand:true,status:true,totalValueCents:true,customerId:true,items:{take:20,orderBy:{sortOrder:'asc'},select:{productName:true,quantity:true}},customer:{select:{contactName:true,tradeName:true,phoneDigits:true,phone2Digits:true,phone3Digits:true,phoneChannel:true,phone2Channel:true,phone3Channel:true}}}});
 if(!quote)return json({error:'Proposta indisponível no seu acesso.'},404);
 if(quote.totalValueCents===null||['ABERTA','CANCELADA','EXPIRADA'].includes(quote.status))return badRequest('Conclua e confira a proposta antes de preparar o resumo.');
 const field=parsed.data.phoneField,channel=field==='phone2Digits'?'phone2Channel':field==='phone3Digits'?'phone3Channel':'phoneChannel';
 if(!quote.customer[field]||quote.customer[channel]==='PHONE')return badRequest('Escolha um telefone do cadastro habilitado para WhatsApp.');
 const total=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(quote.totalValueCents/100);
 const text=[`Resumo da proposta #${quote.id.slice(-6).toUpperCase()} · ${quote.brand==='MIBRO'?'Mibro Brasil':'Sincrofit'}`,`Cliente: ${quote.customer.tradeName||quote.customer.contactName}`,...quote.items.map(item=>`${item.quantity} × ${item.productName}`),`Total registrado: ${total}`,'Confira os itens e as condições da proposta completa com seu vendedor.'].join('\n');
 if(text.length>3500)return badRequest('Resumo muito extenso para uma mensagem. Use o atendimento para combinar o envio do documento.');
 try{return json(await centralRequest('/identity/proposal-selection',{...context,quoteId:quote.id,customerId:quote.customerId,brand:quote.brand,phone:quote.customer[field],text}));}
 catch{return json({error:'Não foi possível preparar o rascunho. Verifique o acesso ao número e à empresa da proposta. Nenhuma mensagem foi enviada.'},503);}
}
