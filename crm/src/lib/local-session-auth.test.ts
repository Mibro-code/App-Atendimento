import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({options:null as any,enabled:false,user:{id:'local',name:'Synthetic',email:'local@example.invalid',role:'REPRESENTANTE',active:true,deletedAt:null,passwordHash:'old-hash'},find:vi.fn(),request:vi.fn()}));
vi.mock('next-auth',()=>({default:(options:any)=>{mocks.options=options;return {auth:vi.fn(),handlers:{},signIn:vi.fn(),signOut:vi.fn()};}}));
vi.mock('next-auth/providers/credentials',()=>({default:(options:any)=>options}));
vi.mock('@/auth.config',()=>({default:{session:{strategy:'jwt'},providers:[]}}));
vi.mock('@/lib/local-credential-proof',async()=>await import('./local-credential-proof'));
vi.mock('@/lib/prisma',()=>({prisma:{user:{findMany:async()=>[{...mocks.user}],findUnique:async()=>({...mocks.user,centralIdentityLink:null}),update:vi.fn()},centralIdentityLink:{findUnique:async()=>null}}}));
vi.mock('@/lib/audit',()=>({logAudit:vi.fn()}));
vi.mock('@/lib/central-identity',()=>({centralEnabled:()=>mocks.enabled,centralRequest:mocks.request}));
vi.mock('bcryptjs',()=>({default:{compare:async(password:string,hash:string)=>password===hash}}));
import '../auth';
beforeEach(()=>{vi.stubEnv('AUTH_SECRET','synthetic-local-session-secret');mocks.enabled=false;mocks.user.passwordHash='old-hash';});
it('local token is revoked after own or administrative reset and new login succeeds',async()=>{
 const login=mocks.options.providers[0].authorize;
 const user=await login({email:mocks.user.email,password:'old-hash'});expect(user).not.toBeNull();
 const token=await mocks.options.callbacks.jwt({token:{},user});expect(token).not.toBeNull();
 mocks.user.passwordHash='new-hash';expect(await mocks.options.callbacks.jwt({token})).toBeNull();
 expect(await login({email:mocks.user.email,password:'old-hash'})).toBeNull();
 const newer=await login({email:mocks.user.email,password:'new-hash'});expect(await mocks.options.callbacks.jwt({token:{},user:newer})).not.toBeNull();
});
it('legacy tokens and primary proof cannot fall back to local auth when central identity is off',async()=>{
 expect(await mocks.options.callbacks.jwt({token:{}})).toBeNull();
 expect(await mocks.options.callbacks.jwt({token:{id:'local',role:'REPRESENTANTE'}})).toBeNull();
 expect(await mocks.options.callbacks.jwt({token:{id:'local',primaryProof:'other-authority'}})).toBeNull();
});
it('reset between login and token issuance cannot mint a proof for a hash never authenticated',async()=>{
 const user=await mocks.options.providers[0].authorize({email:mocks.user.email,password:'old-hash'});mocks.user.passwordHash='admin-reset';
 expect(await mocks.options.callbacks.jwt({token:{},user})).toBeNull();
});
it('credential proof is never returned to the browser session',async()=>{
 const session={user:{}};const result=await mocks.options.callbacks.session({session,token:{id:'local',role:'REPRESENTANTE',localCredentialProof:'private',primaryProof:'private'}});
 expect(result.user).toEqual({id:'local',role:'REPRESENTANTE'});
});
