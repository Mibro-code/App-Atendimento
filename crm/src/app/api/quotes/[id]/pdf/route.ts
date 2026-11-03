import {NextRequest,NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {requireSession} from '@/lib/api-auth';
import {getCustomerScopeFilter} from '@/lib/authz';
import {quotePdfData,QuotePdfDataError} from '@/lib/quotes/quote-pdf-data';
import {commercialForQuote} from '@/lib/proposals/proposal-channel';
import {proposalErrorResponse} from '@/lib/proposals/proposal-api';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
export async function GET(_req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const {user,error}=await requireSession();if(error)return error;
  const {id}=await params;if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id))return NextResponse.json({error:'Proposta inválida.'},{status:400,headers});
  let commercial;
  try { commercial=await commercialForQuote(user,id,'view'); } catch(e) { return proposalErrorResponse(e); }
  const scope=commercial?{}:await getCustomerScopeFilter(user);
  const quote=await prisma.quote.findFirst({where:{id,deletedAt:null,...(commercial?{}:{customer:{is:scope}})},select:{
    id:true,brand:true,mode:true,status:true,deletedAt:true,createdAt:true,totalValueCents:true,subtotalCents:true,discountCents:true,notes:true,productsSummary:true,
    sellerNameSnapshot:true,sellerEmailSnapshot:true,sellerPhoneSnapshot:true,
    seller:{select:{name:true,sellerProfile:{select:{displayName:true}}}},
    customer:{select:{contactName:true,tradeName:true,legalName:true,cnpjDigits:true,cpfDigits:true,email:true,phoneDigits:true,addressStreet:true,addressNumber:true,addressDistrict:true,addressComplement:true,city:true,state:true,zipDigits:true}},
    items:{take:1001,orderBy:[{sortOrder:'asc'},{id:'asc'}],select:{sku:true,productName:true,colorName:true,quantity:true,unitPriceCents:true,lineSubtotalCents:true}},
  }});
  if(!quote)return NextResponse.json({error:'Proposta indisponível no seu acesso.'},{status:404,headers});
  try{
    const data=quotePdfData({...quote,...(commercial?{commercialProposal:commercial}:{})});
    const {renderQuotePdf}=await import('@/lib/quotes/quote-pdf');
    const pdf=await renderQuotePdf(data);
    return new NextResponse(Uint8Array.from(pdf).buffer,{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="proposta-${data.reference}.pdf"`}});
  }catch(e){
    if(e instanceof QuotePdfDataError)return NextResponse.json({error:e.message},{status:422,headers});
    return NextResponse.json({error:'Não foi possível gerar o PDF agora. Tente novamente.'},{status:503,headers});
  }
}
