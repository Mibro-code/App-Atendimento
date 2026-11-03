import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest,NextResponse} from 'next/server';
const mock=vi.hoisted(()=>({session:vi.fn(),hasPrimary:vi.fn(),token:vi.fn(),request:vi.fn(),find:vi.fn(),update:vi.fn(),audit:vi.fn(),compare:vi.fn(),hash:vi.fn()}));
vi.mock('@/lib/api-auth',()=>({requireSession:mock.session,badRequest:(error:string)=>NextResponse.json({error},{status:400})}));
vi.mock('@/lib/prisma',()=>({prisma:{user:{findUnique:mock.find,updateMany:mock.update}}}));
vi.mock('@/lib/primary-password',()=>({hasPrimaryCredentials:mock.hasPrimary}));
vi.mock('@/lib/central-identity',()=>({identityOrigins:()=>({crm:'http://127.0.0.1:4038'}),centralRequest:mock.request}));
vi.mock('next-auth/jwt',()=>({getToken:mock.token}));
vi.mock('@/lib/audit',()=>({logAudit:mock.audit}));
vi.mock('bcryptjs',()=>({default:{compare:mock.compare,hash:mock.hash}}));
import {PATCH} from '../app/api/profile/password/route';
const input={currentPassword:'primary-current',newPassword:'primary-new-123'};
const request=(body=input)=>new NextRequest('http://127.0.0.1:4038/api/profile/password',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{
 vi.resetAllMocks();mock.session.mockResolvedValue({user:{id:'c',role:'VENDEDOR'},error:null});mock.hasPrimary.mockResolvedValue(true);
 mock.token.mockResolvedValue({id:'c',primaryProof:'server-session-proof'});mock.request.mockResolvedValue({ok:true,shared:true,reauthenticate:true});
 mock.find.mockResolvedValue({id:'c',passwordHash:'local-hash'});mock.compare.mockResolvedValue(true);mock.hash.mockResolvedValue('new-local-hash');mock.update.mockResolvedValue({count:1});
});
it('self-profile delegates only session user/proof and never overwrites CRM hash',async()=>{
 const response=await PATCH(request({...input,crmUserId:'victim',primaryProof:'forged'} as typeof input));expect(response.status).toBe(200);
 expect(mock.request).toHaveBeenCalledWith('/identity/password',{crmUserId:'c',primaryProof:'server-session-proof',...input});expect(mock.update).not.toHaveBeenCalled();
 expect(await response.json()).toEqual({ok:true,shared:true,reauthenticate:true});
});
it('requires session before any password operation',async()=>{
 mock.session.mockResolvedValue({user:null,error:NextResponse.json({error:'Unauthorized'},{status:401})});expect((await PATCH(request())).status).toBe(401);expect(mock.request).not.toHaveBeenCalled();expect(mock.update).not.toHaveBeenCalled();
});
it.each([null,{id:'other',primaryProof:'proof'},{id:'c'}])('rejects missing/mismatched encrypted session token',async token=>{
 mock.token.mockResolvedValue(token);expect((await PATCH(request())).status).toBe(401);expect(mock.request).not.toHaveBeenCalled();
});
it.each([400,401,403,409,429])('surfaces denial %s without falling back to CRM password',async statusCode=>{
 mock.request.mockRejectedValue({statusCode});expect((await PATCH(request())).status).toBe(statusCode);expect(mock.update).not.toHaveBeenCalled();
});
it('provider outage never changes local password or reports success',async()=>{
 mock.request.mockRejectedValue(Error('unavailable'));expect((await PATCH(request())).status).toBe(503);expect(mock.update).not.toHaveBeenCalled();
});
it('CRM-only or representative account keeps the existing local change flow',async()=>{
 mock.hasPrimary.mockResolvedValue(false);expect((await PATCH(request())).status).toBe(200);expect(mock.request).not.toHaveBeenCalled();expect(mock.update).toHaveBeenCalledWith({where:{id:'c',passwordHash:'local-hash',active:true,deletedAt:null},data:{passwordHash:'new-local-hash'}});
});
it('invalid new password cannot call either write path',async()=>{
 expect((await PATCH(request({...input,newPassword:'é'.repeat(37)}))).status).toBe(400);expect(mock.request).not.toHaveBeenCalled();expect(mock.update).not.toHaveBeenCalled();
});

it('cannot overwrite a concurrent local administrative reset',async()=>{mock.hasPrimary.mockResolvedValue(false);mock.update.mockResolvedValue({count:0});expect((await PATCH(request())).status).toBe(409);expect(mock.audit).not.toHaveBeenCalled();});
