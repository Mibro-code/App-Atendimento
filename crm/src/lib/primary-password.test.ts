import {beforeEach,describe,it,expect,vi} from 'vitest';
import bcrypt from 'bcryptjs';
const mock=vi.hoisted(()=>({user:vi.fn(),link:vi.fn(),request:vi.fn(),enabled:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/prisma',()=>({prisma:{user:{findUnique:mock.user},centralIdentityLink:{findUnique:mock.link}}}));
vi.mock('@/lib/central-identity',()=>({centralEnabled:mock.enabled,centralRequest:mock.request}));
import {verifyCurrentPassword,hasPrimaryCredentials} from './primary-password';
describe('primary password confirmation',()=>{
 beforeEach(async()=>{vi.resetAllMocks();mock.enabled.mockReturnValue(true);mock.user.mockResolvedValue({id:'c',active:true,deletedAt:null,role:'VENDEDOR',passwordHash:await bcrypt.hash('old-crm-password',4)});mock.link.mockResolvedValue({enabled:true,primaryEmail:'primary@local.invalid',attendanceUserId:'a'});mock.request.mockResolvedValue({crmUserId:'c',attendanceUserId:'a',primaryProof:'opaque'});});
 it('delegates linked secondary confirmation to Attendance',async()=>{
  expect(await verifyCurrentPassword('c','primary-password')).toBe(true);
  expect(mock.request).toHaveBeenCalledWith('/identity/credentials',{crmUserId:'c',email:'primary@local.invalid',password:'primary-password'});
 });
 it('never falls back to old CRM hash if Attendance fails',async()=>{mock.request.mockRejectedValue(Error('unavailable'));expect(await verifyCurrentPassword('c','old-crm-password')).toBe(false);});
 it('rejects disabled link or mismatched identity',async()=>{mock.link.mockResolvedValueOnce({enabled:false});expect(await verifyCurrentPassword('c','old-crm-password')).toBe(false);mock.request.mockResolvedValue({crmUserId:'other',attendanceUserId:'a'});expect(await verifyCurrentPassword('c','primary-password')).toBe(false);});
 it('preserves representative password and does not query primary',async()=>{mock.user.mockResolvedValue({...await mock.user(),role:'REPRESENTANTE'});expect(await verifyCurrentPassword('c','old-crm-password')).toBe(true);expect(mock.request).not.toHaveBeenCalled();expect(await hasPrimaryCredentials('c','REPRESENTANTE')).toBe(false);});
 it('preserves CRM-only and disabled-feature local authentication',async()=>{mock.link.mockResolvedValue(null);expect(await verifyCurrentPassword('c','old-crm-password')).toBe(true);mock.enabled.mockReturnValue(false);expect(await verifyCurrentPassword('c','old-crm-password')).toBe(true);expect(mock.request).not.toHaveBeenCalled();});
 it('rejects inactive or deleted user before checking password',async()=>{mock.user.mockResolvedValue({active:false});expect(await verifyCurrentPassword('c','old-crm-password')).toBe(false);expect(mock.request).not.toHaveBeenCalled();});
});
