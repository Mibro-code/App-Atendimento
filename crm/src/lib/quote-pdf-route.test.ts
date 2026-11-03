import {beforeEach,it,expect,vi} from 'vitest';
import {NextRequest,NextResponse} from 'next/server';
const m=vi.hoisted(()=>({find:vi.fn(),session:vi.fn(),scope:vi.fn(),render:vi.fn(),commercial:vi.fn(),authorize:vi.fn()}));
vi.mock('@/lib/prisma',()=>({prisma:{quote:{findFirst:m.find},commercialProposal:{findUnique:m.commercial}}}));
vi.mock('@/lib/api-auth',()=>({requireSession:m.session}));
vi.mock('@/lib/authz',()=>({getCustomerScopeFilter:m.scope}));
vi.mock('@/lib/quotes/quote-pdf',()=>({renderQuotePdf:m.render}));
vi.mock('@/lib/quotes/quote-pdf-data',()=>import('./quotes/quote-pdf-data'));
vi.mock('@/lib/proposals/proposal-core',()=>({authorize:m.authorize}));
import {GET} from '../app/api/quotes/[id]/pdf/route';
import {sampleQuote} from './quotes/quote-pdf.fixture';
const request=()=>new NextRequest('https://crm.invalid/api/quotes/quote-synthetic-ABC123/pdf');
const call=(id='quote-synthetic-ABC123')=>GET(request(),{params:Promise.resolve({id})});
beforeEach(()=>{vi.clearAllMocks();m.commercial.mockResolvedValue(null);m.session.mockResolvedValue({user:{id:'seller',role:'VENDEDOR'},error:null});m.scope.mockResolvedValue({sellerId:'seller'});m.find.mockResolvedValue(sampleQuote());m.render.mockResolvedValue(new Uint8Array([37,80,68,70,45]));});
it('requires an authenticated current session before looking up any quote',async()=>{
 m.session.mockResolvedValue({user:null,error:NextResponse.json({error:'Não autenticado'},{status:401})});expect((await call()).status).toBe(401);expect(m.find).not.toHaveBeenCalled();expect(m.render).not.toHaveBeenCalled();
});
it('constrains the quote lookup to current portfolio and nondeleted records',async()=>{
 const r=await call();expect(r.status).toBe(200);expect(m.find.mock.calls[0][0].where).toEqual({id:'quote-synthetic-ABC123',deletedAt:null,customer:{is:{sellerId:'seller'}}});expect(r.headers.get('Content-Type')).toBe('application/pdf');expect(r.headers.get('Content-Disposition')).toContain('attachment; filename="proposta-ABC123.pdf"');expect(r.headers.get('Cache-Control')).toContain('no-store');
});
it('returns 404 for another portfolio, including guessed quote IDs, without rendering',async()=>{
 m.find.mockResolvedValue(null);expect((await call()).status).toBe(404);expect(m.render).not.toHaveBeenCalled();
});
it('does not generate a PDF for a draft or malformed identifier',async()=>{
 m.find.mockResolvedValue(sampleQuote({status:'ABERTA'}));expect((await call()).status).toBe(422);expect(m.render).not.toHaveBeenCalled();vi.clearAllMocks();expect((await call('../bad')).status).toBe(400);expect(m.find).not.toHaveBeenCalled();
});
it('reports render failure without exposing server diagnostics or changing quote state',async()=>{
 m.render.mockRejectedValue(Error('sensitive-internal-diagnostic'));const r=await call();expect(r.status).toBe(503);expect(await r.text()).not.toContain('sensitive-internal-diagnostic');
});

it('commercial PDF uses proposal scope, including Finance, and marks cancelled previews',async()=>{
 m.commercial.mockResolvedValue({id:'proposal'});m.authorize.mockResolvedValue({p:{freightCents:700,commercialStatus:'CANCELADA',version:2,approvalStatus:'INVALIDADA',approvedVersion:1}});
 const r=await call();expect(r.status).toBe(200);expect(m.authorize).toHaveBeenCalledWith({id:'seller',role:'VENDEDOR'},'proposal','view');expect(m.find.mock.calls[0][0].where).toEqual({id:'quote-synthetic-ABC123',deletedAt:null});expect(m.render.mock.calls[0][0]).toMatchObject({total:3200,freight:700});expect(m.render.mock.calls[0][0].watermark).toContain('CANCELADA');
});
