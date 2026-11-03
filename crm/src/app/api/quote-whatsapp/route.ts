import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {prisma} from '@/lib/prisma';
import {requireSession,forbidden,badRequest} from '@/lib/api-auth';
import {getCustomerScopeFilter} from '@/lib/authz';
import {centralSession} from '@/lib/central-session';
import {centralRequest} from '@/lib/central-identity';
import {centralContactSource,exactPhoneVariants,contactLinkKey} from '@/lib/central-contact-source';
import {commercialForQuote} from '@/lib/proposals/proposal-channel';
import {proposalErrorResponse} from '@/lib/proposals/proposal-api';
import {contentOf} from '@/lib/proposals/proposal-access';
import {proposalTotals} from '@/lib/proposals/proposal-rules';
import {consultProposal,type OrderDocuments} from '@/lib/proposals/proposal-operations';
const input=z.object({quoteId:z.string().min(1).max(128),phoneField:z.enum(['phoneDigits','phone2Digits','phone3Digits']).default('phoneDigits'),originConversationId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),includeOrderUpdates:z.boolean().default(false)});
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(req:NextRequest){
 const {user,error}=await requireSession();if(error)return error;
 const context=await centralSession(req,user);if(!context)return forbidden('Conta sem acesso integrado ao Atendimento.');
 const parsed=input.safeParse(await req.json().catch(()=>null));if(!parsed.success)return badRequest('Proposta ou telefone inválido.');
 const quote=await prisma.quote.findFirst({where:{id:parsed.data.quoteId,deletedAt:null,customer:{is:await getCustomerScopeFilter(user)}},select:{id:true,brand:true,status:true,totalValueCents:true,customerId:true,items:{take:20,orderBy:{sortOrder:'asc'},select:{productName:true,quantity:true}},customer:{select:{contactName:true,tradeName:true,phoneDigits:true,phone2Digits:true,phone3Digits:true,phoneChannel:true,phone2Channel:true,phone3Channel:true}}}});
 if(!quote)return json({error:'Proposta indisponível no seu acesso.'},404);
 let commercial;
 try{commercial=await commercialForQuote(user,quote.id,parsed.data.includeOrderUpdates?'prepare_order_update':'register_dispatch');}catch(e){return proposalErrorResponse(e);}
 if(parsed.data.includeOrderUpdates&&!commercial)return badRequest('Esta proposta não possui pedido integrado para compartilhar.');
 if(quote.totalValueCents===null||['ABERTA','CANCELADA','EXPIRADA'].includes(quote.status))return badRequest('Conclua e confira a proposta antes de preparar o resumo.');
 const field=parsed.data.phoneField,channel=field==='phone2Digits'?'phone2Channel':field==='phone3Digits'?'phone3Channel':'phoneChannel';
 let phone=quote.customer[field];
 if(parsed.data.originConversationId){
  try{
   const source=await centralContactSource(req,user,parsed.data.originConversationId);
   const link=await prisma.centralContactLink.findUnique({where:{attendanceCompanyId_attendanceContactId:contactLinkKey(source)},select:{customerId:true}});
   const variants=new Set(exactPhoneVariants([quote.customer.phoneDigits,quote.customer.phone2Digits,quote.customer.phone3Digits].filter((v):v is string=>Boolean(v))));
   if(link?link.customerId!==quote.customerId:!exactPhoneVariants(source.phones).some(p=>variants.has(p)))return forbidden('A conversa de origem não pertence ao cliente desta proposta.');
   phone=source.phones[0]||null;
  }catch{return forbidden('A conversa de origem não está disponível no seu acesso.');}
 }else if(!phone||quote.customer[channel]==='PHONE')return badRequest('Escolha um telefone do cadastro habilitado para WhatsApp.');
 if(!phone)return badRequest('A conversa de origem não possui um telefone válido.');
 const total=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((commercial?proposalTotals(contentOf(commercial)).totalCents:quote.totalValueCents)/100);
 let documents:OrderDocuments|null=null;
 if(parsed.data.includeOrderUpdates&&commercial){try{documents=await consultProposal(user,commercial.id,'documents');}catch(e){return proposalErrorResponse(e);}}
 const text=documents&&commercial?[`Pedido nº ${commercial.olistOrderNumber||commercial.olistOrderId}`,`Cliente: ${quote.customer.tradeName||quote.customer.contactName}`,documents.invoice_link?`Nota fiscal: ${documents.invoice_link}`:null,documents.tracking_code?`Rastreamento: ${documents.tracking_code}`:null,documents.tracking_link,`Situação registrada: ${commercial.olistOrderSituation||'Em acompanhamento'}`].filter(Boolean).join('\n'):[`Resumo da proposta #${quote.id.slice(-6).toUpperCase()} · ${quote.brand==='MIBRO'?'Mibro Brasil':'Sincrofit'}`,`Cliente: ${quote.customer.tradeName||quote.customer.contactName}`,...quote.items.map(item=>`${item.quantity} × ${item.productName}`),`Total registrado: ${total}`,commercial?`Frete incluído: ${new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(commercial.freightCents/100)}`:null,commercial?.paymentText?`Pagamento: ${commercial.paymentText}`:null,commercial?.deliveryTerm?`Prazo: ${commercial.deliveryTerm}`:null,'Confira os itens e as condições da proposta completa com seu vendedor.'].filter(Boolean).join('\n');
 if(text.length>3500)return badRequest('Resumo muito extenso para uma mensagem. Use o atendimento para combinar o envio do documento.');
 try{return json(await centralRequest('/identity/proposal-selection',{...context,quoteId:quote.id,customerId:quote.customerId,brand:quote.brand,phone,text,...(parsed.data.originConversationId?{originConversationId:parsed.data.originConversationId}:{})}));}
 catch{return json({error:'Não foi possível preparar o rascunho. Verifique o acesso ao número e à empresa da proposta. Nenhuma mensagem foi enviada.'},503);}
}
