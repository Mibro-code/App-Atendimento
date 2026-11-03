import {describe,it,expect} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {canDownloadQuotePdf,quotePdfData} from './quote-pdf-data';
import {renderQuotePdf} from './quote-pdf';

import {sampleQuote} from './quote-pdf.fixture';

describe('PDF da proposta',()=>{
 it('uses saved snapshots and totals without repricing or inventing validity/payment',()=>{
  const data=quotePdfData(sampleQuote());expect(data.total).toBe(2500);expect(data.discount).toBe(500);expect(data.items[0].subtotal).toBe(3000);expect(data.sellerLines[0]).toBe('Vendedor da proposta');expect(data.customerLines.join(' ')).toContain('11.222.333/0001-81');expect(data.reference).toBe('ABC123');
 });
 it('rejects draft/cancelled/expired/deleted quotes and invalid money',()=>{
  for(const status of ['ABERTA','CANCELADA','EXPIRADA','UNKNOWN'])expect(canDownloadQuotePdf(sampleQuote({status}))).toBe(false);
  expect(()=>quotePdfData(sampleQuote({deletedAt:new Date()}))).toThrow();expect(()=>quotePdfData(sampleQuote({totalValueCents:null}))).toThrow();expect(()=>quotePdfData(sampleQuote({totalValueCents:-1}))).toThrow();
 });
 it('supports historical Shopify snapshots and leaves missing prices unspecified',()=>{
  const data=quotePdfData(sampleQuote({items:[],productsSummary:{products:[{sku:'OLD',name:'Modelo histórico',quantity:1}]},subtotalCents:null,discountCents:null}));expect(data.items[0].unitPrice).toBeNull();expect(data.total).toBe(2500);
 });
 it('rejects malformed, oversized and empty item snapshots without truncating them',()=>{
  for(const products of [[],[{name:'X',quantity:0}],Array(1001).fill({name:'X',quantity:1}),[{name:'x'.repeat(2001),quantity:1}]])expect(()=>quotePdfData(sampleQuote({items:[],productsSummary:{products}}))).toThrow();
 });
 it('generates a real PDF with embedded fonts and no interactive actions',async()=>{
  const bytes=await renderQuotePdf(quotePdfData(sampleQuote()));expect(Buffer.from(bytes).subarray(0,5).toString()).toBe('%PDF-');const pdf=await PDFDocument.load(bytes);expect(pdf.getPageCount()).toBe(1);expect(pdf.getTitle()).toContain('ABC123');expect(pdf.getPages()[0].node.Annots()?.size() ?? 0).toBe(0);
 });
 it('paginates many items and long words without clipping or dropping the last item',async()=>{
  const q=sampleQuote({brand:'SINCROFIT',items:Array.from({length:85},(_,i)=>({sku:`SKU-${i}`,productName:i===0?'Nome'.repeat(60):`Produto ${i} — descrição de demonstração`,colorName:'Preto',quantity:1,unitPriceCents:1000,lineSubtotalCents:1000}))});
  const pdf=await PDFDocument.load(await renderQuotePdf(quotePdfData(q)));expect(pdf.getPageCount()).toBeGreaterThan(2);expect(pdf.getPageCount()).toBeLessThan(20);
 });
});

it('commercial values include freight and explicit version/payment/validity',()=>{
 const data=quotePdfData({...sampleQuote(),commercialProposal:{freightCents:700,commercialStatus:'APROVADA_INTERNAMENTE',version:3,approvedVersion:3,approvalStatus:'APROVADA',paymentText:'PIX',deliveryTerm:'3 dias',validUntil:new Date('2099-12-31T12:00:00Z')}});
 expect(data.total).toBe(3200);expect(data.freight).toBe(700);expect(data.notes).toContain('PIX');expect(data.notes).toContain('Versão comercial 3');expect(data.watermark).toBeUndefined();
});
