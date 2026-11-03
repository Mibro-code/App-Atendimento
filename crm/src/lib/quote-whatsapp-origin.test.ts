import {beforeEach,it,expect,vi} from 'vitest';
import {NextRequest,NextResponse} from 'next/server';
const mocks=vi.hoisted(()=>({quote:vi.fn(),link:vi.fn(),source:vi.fn(),bridge:vi.fn(),session:vi.fn(),commercial:vi.fn(),authorize:vi.fn(),olist:vi.fn()}));
vi.mock('@/lib/prisma',()=>({prisma:{quote:{findFirst:mocks.quote},centralContactLink:{findUnique:mocks.link},commercialProposal:{findUnique:mocks.commercial}}}));
vi.mock('@/lib/api-auth',()=>({requireSession:async()=>({user:{id:'seller',role:'VENDEDOR'},error:null}),forbidden:(error:string)=>NextResponse.json({error},{status:403}),badRequest:(error:string)=>NextResponse.json({error},{status:400})}));
vi.mock('@/lib/authz',()=>({getCustomerScopeFilter:async()=>({sellerId:'seller'})}));
vi.mock('@/lib/central-session',()=>({centralSession:mocks.session}));
vi.mock('@/lib/central-identity',()=>({centralRequest:mocks.bridge}));
vi.mock('@/lib/central-contact-source',()=>({centralContactSource:mocks.source,contactLinkKey:(s:{company:{id:string};contactId:string})=>({attendanceCompanyId:s.company.id,attendanceContactId:s.contactId}),exactPhoneVariants:(phones:string[])=>phones}));
vi.mock('@/lib/proposals/proposal-core',()=>({authorize:mocks.authorize}));
vi.mock('@/lib/olist/bridge-client',()=>({callOlistBridge:mocks.olist}));
import {ProposalError} from './proposals/proposal-rules';
import {POST} from '../app/api/quote-whatsapp/route';
beforeEach(()=>{
 vi.clearAllMocks();mocks.commercial.mockResolvedValue(null);mocks.session.mockResolvedValue({crmUserId:'seller',primaryProof:'SYNTHETIC'});
 mocks.quote.mockResolvedValue({id:'quote',customerId:'customer',brand:'SINCROFIT',status:'CALCULADA',totalValueCents:10000,items:[{productName:'Produto fictício',quantity:1}],customer:{contactName:'Cliente fictício',tradeName:null,phoneDigits:'5511999999999',phone2Digits:null,phone3Digits:null,phoneChannel:'WHATSAPP'}});
 mocks.link.mockResolvedValue(null);mocks.source.mockResolvedValue({id:'conversation',contactId:'contact',phones:['5511999999999'],company:{id:'mibro',slug:'mibro',name:'Mibro'}});mocks.bridge.mockResolvedValue({nextUrl:'https://attendance.invalid/identity/start?proposal=synthetic'});
});
const request=(body:object)=>new NextRequest('https://crm.invalid/api/quote-whatsapp',{method:'POST',body:JSON.stringify(body)});
it('uses the actual origin conversation regardless of quote brand',async()=>{
 const r=await POST(request({quoteId:'quote',originConversationId:'conversation'}));expect(r.status).toBe(200);
 expect(mocks.bridge.mock.calls[0][1]).toMatchObject({brand:'SINCROFIT',originConversationId:'conversation',phone:'5511999999999'});
});
it('rejects an origin belonging to a different customer',async()=>{
 mocks.source.mockResolvedValue({contactId:'other',phones:['5511888888888'],company:{id:'mibro'}});
 expect((await POST(request({quoteId:'quote',originConversationId:'conversation'}))).status).toBe(403);expect(mocks.bridge).not.toHaveBeenCalled();
});
it('an explicit CRM link overrides phone matching only for the same customer',async()=>{
 mocks.link.mockResolvedValue({customerId:'other-customer'});
 expect((await POST(request({quoteId:'quote',originConversationId:'conversation'}))).status).toBe(403);expect(mocks.bridge).not.toHaveBeenCalled();
});
it('does not grant representatives or unlinked accounts access to Attendance',async()=>{
 mocks.session.mockResolvedValue(null);expect((await POST(request({quoteId:'quote',originConversationId:'conversation'}))).status).toBe(403);expect(mocks.source).not.toHaveBeenCalled();
});
it('legacy phone selection remains supported without an origin',async()=>{
 expect((await POST(request({quoteId:'quote'}))).status).toBe(200);expect(mocks.source).not.toHaveBeenCalled();expect(mocks.bridge.mock.calls[0][1]).not.toHaveProperty('originConversationId');
});
it('does not send an open quote or accept arbitrary origin URL parameters',async()=>{
 expect((await POST(request({quoteId:'quote',originConversationId:'../../other'}))).status).toBe(400);
 mocks.quote.mockResolvedValue({...await mocks.quote(),status:'ABERTA'});expect((await POST(request({quoteId:'quote'}))).status).toBe(400);expect(mocks.bridge).not.toHaveBeenCalled();
});

it('legacy WhatsApp cannot bypass commercial approval',async()=>{
 mocks.commercial.mockResolvedValue({id:'pending-proposal'});mocks.authorize.mockRejectedValue(new ProposalError('Precisa de aprovação.','ACTION_NOT_ALLOWED',403));
 expect((await POST(request({quoteId:'quote'}))).status).toBe(403);expect(mocks.bridge).not.toHaveBeenCalled();
});
it('prepares server-verified order documents in origin chat without sending a message',async()=>{
 mocks.commercial.mockResolvedValue({id:'commercial-proposal'});
 mocks.authorize.mockResolvedValue({p:{id:'commercial-proposal',brand:'SINCROFIT',olistOrderId:'77',olistOrderNumber:'123',olistOrderSituation:'Aprovada',freightCents:0,quote:{items:[{sku:'DEMO',quantity:1,unitPriceCents:10000}],discountCents:0}}});
 mocks.olist.mockResolvedValue({invoice_id:'10',invoice_link:'https://fiscal.example.invalid/10',tracking_code:'DEMO123',tracking_link:null,checked_at:new Date().toISOString()});
 const r=await POST(request({quoteId:'quote',originConversationId:'conversation',includeOrderUpdates:true,invoice_link:'https://injected.invalid'}));expect(r.status).toBe(200);
 expect(mocks.authorize.mock.calls.map(c=>c[2])).toEqual(['prepare_order_update','view']);expect(mocks.olist).toHaveBeenCalledWith('SINCROFIT','/internal/crm/orders/consult',{brand:'sincrofit',kind:'documents',olist_order_id:'77'});
 expect(mocks.bridge.mock.calls[0][1]).toMatchObject({originConversationId:'conversation',phone:'5511999999999'});expect(mocks.bridge.mock.calls[0][1].text).toContain('https://fiscal.example.invalid/10');expect(mocks.bridge.mock.calls[0][1].text).not.toContain('injected.invalid');
});
