import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks=vi.hoisted(()=>({session:vi.fn(),find:vi.fn(),transaction:vi.fn(),create:vi.fn(),profile:vi.fn(),audit:vi.fn(),link:vi.fn()}));
vi.mock('@/lib/prisma',()=>({prisma:{user:{findUnique:mocks.find},$transaction:mocks.transaction}}));
vi.mock('@/lib/api-auth',()=>({requireSession:mocks.session,badRequest:vi.fn(),forbidden:vi.fn()}));
vi.mock('@/lib/audit',()=>({logAudit:mocks.audit}));
vi.mock('@/lib/central-account-link',()=>({linkCentralAccount:mocks.link}));
vi.mock('@/lib/team-rules',()=>({canSupervisorCreateTeamUser:()=>false}));
vi.mock('@/lib/rca-server',()=>({generateNextRca:async()=> '001',isUniqueViolation:()=>false}));
vi.mock('bcryptjs',()=>({default:{hash:async()=> 'fixture-hash'}}));
import { POST } from '../app/api/users/route';
const created={id:'c',name:'Pessoa',email:'person@example.invalid',role:'VENDEDOR',rca:'001'};
beforeEach(()=>{
  vi.resetAllMocks();mocks.session.mockResolvedValue({user:{id:'admin',role:'ADMIN'}});mocks.find.mockResolvedValue(null);mocks.create.mockResolvedValue(created);
  mocks.transaction.mockImplementation(fn=>fn({user:{create:mocks.create},sellerProfile:{create:mocks.profile}}));mocks.link.mockResolvedValue({status:'LINKED'});
});
const request=()=>new NextRequest('http://localhost/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:created.name,email:created.email,role:'VENDEDOR',password:'fixture-only-password'})});
it('creating a CRM account invokes automatic linking after committing creation',async()=>{
  const response=await POST(request());expect(response.status).toBe(201);expect((await response.json()).centralAccess.status).toBe('LINKED');
  expect(mocks.link).toHaveBeenCalledWith({...created,active:true,deletedAt:null});
  expect(mocks.transaction.mock.invocationCallOrder[0]).toBeLessThan(mocks.link.mock.invocationCallOrder[0]);
});
it('bridge failure preserves new account and returns a pending warning, not a duplicate-create error',async()=>{
  mocks.link.mockRejectedValue(Error('timeout'));
  const response=await POST(request()),body=await response.json();expect(response.status).toBe(201);expect(body.user.id).toBe('c');
  expect(body.centralAccess.status).toBe('PENDING');expect(body.centralAccess.warning).toContain('Conta criada');expect(mocks.create).toHaveBeenCalledOnce();
});
it('CRM-only new account remains valid without an Attendance match',async()=>{
  mocks.link.mockResolvedValue({status:'NO_MATCH'});const response=await POST(request());expect(response.status).toBe(201);expect((await response.json()).centralAccess.status).toBe('NO_MATCH');
});
