import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as rules from '../app/services/crm-proposal-bridge-rules.js';
import * as base from '../app/services/crm-order-bridge-rules.js';
import {validateCrmProposalEmail, buildCrmProposalHtml} from '../app/services/crm-proposal-email.server.js';
const brand=base.BRIDGE_BRANDS.mibro;
const order=(code=0)=>({id:5001,numeroPedido:7001,situacao:code,cliente:{cpfCnpj:'11222333000181'},vendedor:{id:55},itens:[{produto:{sku:'DEMO'},quantidade:1,valorUnitario:100}],valorTotalPedido:100});
function runtime(over={}){
 const calls=[];
 const source=fs.readFileSync(new URL('../app/services/crm-proposal-bridge.server.js',import.meta.url),'utf8').replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/export async function/g,'async function');
 const ctx=vm.createContext({...rules,...base,URL,process:{env:{}},findOlistContactByTaxId:async()=>({id:77}),findOlistProductBySku:async(_shop,sku)=>({id:1,sku}),getOlistOrder:async()=>order(),olistRequest:async(_shop,path,options)=>{calls.push({path,options});return {};},...over});
 vm.runInContext(source+'\nglobalThis.api={findCrmProposal,approveCrmOrder,consultCrmOrder,inspectCrmOrder,upsertCrmProposal};',ctx);
 return {api:ctx.api,calls};
}
test('recovery finds reference after first page, without writes',async()=>{
 const calls=[];const {api}=runtime({olistRequest:async(_s,p,o)=>{calls.push(o);return p==='/orcamentos'?(o.query.offset===0?{itens:Array.from({length:100},(_,i)=>({id:i+1,contato:{id:88}})),paginacao:{total:101}}:{itens:[{id:900,contato:{id:77}}],paginacao:{total:101}}):{id:900,observacao:'Ref. CRM-0000000001'};}});
 const result=await api.findCrmProposal('test',{brand:'mibro',crm_proposal_id:'ckproposal0000000000000001',seller_olist_id:'55',tax_id:'11222333000181',since:'2026-10-01'},brand);
 assert.equal(result.found,true);assert.equal(result.complete,true);assert.ok(calls.every(c=>c.method==='GET'));
});
test('recovery fails closed on incomplete pagination',async()=>{
 const {api}=runtime({olistRequest:async()=>({itens:Array.from({length:100},()=>({id:1,contato:{id:88}})),paginacao:{total:2000}})});
 await assert.rejects(api.findCrmProposal('test',{brand:'mibro',crm_proposal_id:'ckproposal0000000000000001',seller_olist_id:'55',tax_id:'11222333000181'},brand),e=>e.code==='OLIST_SEARCH_INCOMPLETE');
});
test('approval uses official situation 3, reads back, never creates order or posts finance',async()=>{
 let code=0;const calls=[];const {api}=runtime({getOlistOrder:async()=>order(code),olistRequest:async(_s,p,o)=>{calls.push({p,o});code=3;}});
 const result=await api.approveCrmOrder('test',{brand:'mibro',olist_order_id:'5001',expected_order:rules.normalizeOrder(order())},brand);
 assert.equal(result.order.situation_code,3);assert.equal(calls.length,1);assert.equal(calls[0].p,'/pedidos/5001/situacao');assert.equal(JSON.parse(calls[0].o.body).situacao,3);assert.equal(calls[0].o.method,'PUT');
});
test('approval after lost response reconciles already approved without write',async()=>{
 const {api,calls}=runtime({getOlistOrder:async()=>order(3)});
 const result=await api.approveCrmOrder('test',{brand:'mibro',olist_order_id:'5001',expected_order:rules.normalizeOrder(order())},brand);
 assert.equal(result.already_approved,true);assert.equal(calls.length,0);
});
for(const code of [2,1,8,5,6])test(`approval rejects non-open situation ${code}`,async()=>{
 const {api,calls}=runtime({getOlistOrder:async()=>order(code)});
 await assert.rejects(api.approveCrmOrder('test',{brand:'mibro',olist_order_id:'5001',expected_order:rules.normalizeOrder(order())},brand),e=>e.code==='ORDER_NOT_OPEN');assert.equal(calls.length,0);
});
test('approval rejects changed order and cross-brand payload before writing',async()=>{
 const changed={...order(),valorTotalPedido:101};const {api,calls}=runtime({getOlistOrder:async()=>changed});
 await assert.rejects(api.approveCrmOrder('test',{brand:'mibro',olist_order_id:'5001',expected_order:rules.normalizeOrder(order())},brand),e=>e.code==='ORDER_APPROVAL_CONFLICT');
 await assert.rejects(api.approveCrmOrder('test',{brand:'sincrofit',olist_order_id:'5001'},brand),e=>e.code==='BRAND_MISMATCH');assert.equal(calls.length,0);
});
test('stock is read-only, deduplicates SKUs and preserves unknown balance',async()=>{
 const {api,calls}=runtime({olistRequest:async()=>({disponivel:null,reservado:0})});
 const result=await api.consultCrmOrder('test',{brand:'mibro',kind:'stock',skus:['DEMO','DEMO']},brand);assert.equal(result.stock.length,1);assert.equal(result.stock[0].available,null);assert.equal(calls.length,0);
});
test('documents come from linked invoice; unsafe URLs are excluded',async()=>{
 const calls=[];const {api}=runtime({getOlistOrder:async()=>({...order(),idNotaFiscal:20,transportador:{urlRastreamento:'javascript:alert(1)',codigoRastreamento:'DEMO123'}}),olistRequest:async(_s,p,o)=>{calls.push({p,o});return {link:'https://fiscal.example.invalid/nota/20'};}});
 const result=await api.consultCrmOrder('test',{brand:'mibro',kind:'documents',olist_order_id:'5001'},brand);assert.equal(result.invoice_link,'https://fiscal.example.invalid/nota/20');assert.equal(result.tracking_link,null);assert.equal(calls[0].p,'/notas/20/link');assert.equal(calls[0].o.method,'GET');
});
test('financial inquiry paginates installments and reads receipts, without posting',async()=>{
 const calls=[];const {api}=runtime({olistRequest:async(_s,p,o)=>{calls.push({p,o});return p==='/contas-receber'?{itens:[{id:1,valor:100,saldo:40,situacao:'parcial',dataVencimento:'2026-11-01'}]}:[{data:'2026-10-30',valorPago:60}];}});
 const result=await api.consultCrmOrder('test',{brand:'mibro',kind:'financial',olist_order_id:'5001'},brand);assert.equal(result.installments[0].balance_cents,4000);assert.equal(result.installments[0].payments[0].amount_cents,6000);assert.ok(calls.every(c=>c.o.method==='GET'));
});
test('commercial email includes freight and same commercial conditions',()=>{
 const p=validateCrmProposalEmail({brand:'mibro',crm_quote_id:'ckquotation00000000000001',to:'customer@example.invalid',items:[{name:'Demo',sku:'DEMO',quantity:1,unit_price_cents:10000}],discount_cents:0,freight_cents:2000,commercial_version:2,payment_text:'PIX',delivery_term:'3 dias',valid_until:'2026-11-30'},brand);
 assert.equal(p.total,12000);const html=buildCrmProposalHtml(p,{name:'Mibro',primary:'#000',background:'#fff',border:'#ccc'});assert.match(html,/PIX/);assert.match(html,/2026-11-30/);assert.doesNotMatch(html,/Valores sem impostos e frete/);
});
test('successful creation followed by readback 404 stays uncertain, never definitive refusal',async()=>{
 let writes=0;class ApiError extends Error { constructor(){super('Readback not indexed');this.status=404;} }
 const {api}=runtime({OlistApiError:ApiError,olistRequest:async(_s,p,o)=>{if(p==='/orcamentos'&&o.method==='POST'){writes++;return {id:900,numeroProposta:123};}if(p.endsWith('/marcadores'))return {};throw new ApiError();}});
 await assert.rejects(api.upsertCrmProposal('test',{brand:'mibro',crm_proposal_id:'ckproposal0000000000000001',crm_reference:'CRM-0000000001',seller_olist_id:'55',customer:{tax_id:'11222333000181',company_name:'Synthetic'},items:[{sku:'DEMO',quantity:1,unit_price_cents:10000}],discount_cents:0},brand),e=>e.code==='OLIST_CREATE_UNCERTAIN'&&e.status===502&&e.details.olist_proposal_id==='900');assert.equal(writes,1);
});
test('financial inquiry includes a second page of receivables',async()=>{
 const offsets=[];const {api}=runtime({olistRequest:async(_s,p,o)=>{if(p!=='/contas-receber')return [];offsets.push(o.query.offset);return o.query.offset===0?{itens:Array.from({length:100},(_,i)=>({id:i+1,valor:1,saldo:1,situacao:'aberto'})),paginacao:{total:101}}:{itens:[{id:101,valor:1,saldo:1,situacao:'aberto'}],paginacao:{total:101}};}});
 const result=await api.consultCrmOrder('test',{brand:'mibro',kind:'financial',olist_order_id:'5001'},brand);assert.equal(result.installments.length,101);assert.deepEqual(offsets,[0,100]);
});
