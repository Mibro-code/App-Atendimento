import {formatCnpjOrCpf} from '../format';

export function canDownloadQuotePdf(q:{status:string;deletedAt:Date|null;totalValueCents:number|null}) {
  return !q.deletedAt && ['CALCULADA','ENVIADA','ENVIADA_PARA_ANALISE','CONVERTIDA'].includes(q.status) && Number.isSafeInteger(q.totalValueCents) && q.totalValueCents!==null && q.totalValueCents>=0;
}
export class QuotePdfDataError extends Error {}
export type QuotePdfSource={
  id:string;brand:'MIBRO'|'SINCROFIT';mode:string;status:string;deletedAt:Date|null;createdAt:Date;
  totalValueCents:number|null;subtotalCents:number|null;discountCents:number|null;notes:string|null;productsSummary:unknown;
  sellerNameSnapshot:string|null;sellerEmailSnapshot:string|null;sellerPhoneSnapshot:string|null;
  seller:{name:string;sellerProfile:{displayName:string|null}|null};
  customer:{contactName:string;tradeName:string|null;legalName:string|null;cnpjDigits:string|null;cpfDigits:string|null;email:string|null;phoneDigits:string|null;addressStreet:string|null;addressNumber:string|null;addressDistrict:string|null;addressComplement:string|null;city:string|null;state:string|null;zipDigits:string|null};
  items:{sku:string;productName:string;colorName:string|null;quantity:number;unitPriceCents:number;lineSubtotalCents:number}[];
  commercialProposal?: {freightCents:number;commercialStatus?:string;approvalStatus?:string;approvedVersion?:number|null;version?:number;validUntil?:Date|null;paymentText?:string|null;paymentCondition?:string|null;deliveryTerm?:string|null;customerNotes?:string|null};
};
export type QuotePdfData={reference:string;brand:'MIBRO'|'SINCROFIT';simulation:boolean;createdAt:Date;customerLines:string[];sellerLines:string[];notes:string;total:number;subtotal:number|null;discount:number|null;freight?:number|null;watermark?:string;items:{description:string;detail:string;quantity:number;unitPrice:number|null;subtotal:number|null}[]};
function text(value:unknown,max=2000):string {
  if(typeof value!=='string')return '';
  if(value.length>max)throw new QuotePdfDataError('A proposta contém um texto extenso demais para o PDF.');
  return value.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim();
}
function cents(value:unknown):number|null {
  if(value===null||value===undefined)return null;
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new QuotePdfDataError('A proposta contém um valor inválido. Confira os dados salvos.');
  return value;
}
export function quotePdfData(q:QuotePdfSource):QuotePdfData {
  if(!canDownloadQuotePdf(q))throw new QuotePdfDataError('Conclua uma proposta válida antes de baixar o PDF.');
  const snapshot=q.productsSummary&&typeof q.productsSummary==='object'?q.productsSummary as {products?:unknown}:{};
  const raw=q.items.length?q.items.map(i=>({name:i.productName,sku:i.sku,variant:i.colorName,quantity:i.quantity,unitPriceCents:i.unitPriceCents,subtotalCents:i.lineSubtotalCents})):snapshot.products;
  if(!Array.isArray(raw)||raw.length===0)throw new QuotePdfDataError('A proposta não possui itens salvos para gerar o PDF.');
  if(raw.length>1000)throw new QuotePdfDataError('A proposta excede o limite de 1.000 itens para baixar em PDF.');
  const items=raw.map((entry:unknown)=>{
    if(!entry||typeof entry!=='object')throw new QuotePdfDataError('Item inválido na proposta.');
    const i=entry as Record<string,unknown>;
    if(typeof i.quantity!=='number'||!Number.isSafeInteger(i.quantity)||i.quantity<=0||i.quantity>100000)throw new QuotePdfDataError('Confira as quantidades dos itens salvos.');
    return {description:text(i.name)||text(i.sku)||'Item sem descrição',detail:[text(i.sku),text(i.variant)].filter(Boolean).join(' · '),quantity:i.quantity,unitPrice:cents(i.unitPriceCents),subtotal:cents(i.subtotalCents)};
  });
  const c=q.customer;
  const document=c.cnpjDigits||c.cpfDigits;
  const customerLines=[c.tradeName||c.legalName||c.contactName,c.tradeName||c.legalName?c.contactName:null,c.tradeName&&c.legalName&&c.tradeName!==c.legalName?c.legalName:null,document?`${c.cnpjDigits?'CNPJ':'CPF'}: ${formatCnpjOrCpf(document)}`:null,[c.phoneDigits,c.email].filter(Boolean).join(' · '),[c.addressStreet,c.addressNumber,c.addressComplement].filter(Boolean).join(', '),[c.addressDistrict,c.city,c.state,c.zipDigits].filter(Boolean).join(' · ')].filter((v):v is string=>Boolean(v)).map(v=>text(v));
  const sellerLines=[q.sellerNameSnapshot||q.seller.sellerProfile?.displayName||q.seller.name,q.sellerEmailSnapshot,q.sellerPhoneSnapshot].filter((v):v is string=>Boolean(v)).map(v=>text(v));
  const p=q.commercialProposal;
  const freight=p?cents(p.freightCents):null;
  const expired=!!p?.validUntil&&p.validUntil<new Date();
  const internal=!!p&&(expired||['RASCUNHO','AGUARDANDO_APROVACAO','REPROVADA_INTERNAMENTE','CANCELADA','RECUSADA'].includes(p.commercialStatus??'')||p.approvalStatus!=='APROVADA'||p.approvedVersion!==p.version);
  const watermark=internal?`PRÉVIA INTERNA · ${expired?'EXPIRADA':p?.commercialStatus??'SEM APROVAÇÃO'} · NÃO ENVIAR`:undefined;
  const notes=p?[p.customerNotes,p.version?`Versão comercial ${p.version}`:null,p.paymentText?`Pagamento: ${p.paymentText}`:null,p.paymentCondition?`Condição: ${p.paymentCondition}`:null,p.deliveryTerm?`Prazo: ${p.deliveryTerm}`:null,p.validUntil?`Validade: ${new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo'}).format(p.validUntil)}`:null].filter(Boolean).join('\n'):text(q.notes,8000);
  const total=p?items.reduce((sum,i)=>sum+(i.subtotal??0),0)-(cents(q.discountCents)??0)+(freight??0):cents(q.totalValueCents)!;
  return {reference:q.id.slice(-6).toUpperCase(),brand:q.brand,simulation:q.mode==='SIMULATION',createdAt:q.createdAt,customerLines,sellerLines,items,total,subtotal:cents(q.subtotalCents),discount:cents(q.discountCents),freight,watermark,notes:text(notes,8000)};
}
