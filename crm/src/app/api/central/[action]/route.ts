import {NextRequest,NextResponse} from 'next/server';
import {cookies} from 'next/headers';
import {SignJWT,jwtVerify} from 'jose';
import {getToken} from 'next-auth/jwt';
import {auth,signIn} from '@/auth';
import {prisma} from '@/lib/prisma';
import {centralEnabled,centralRequest,identityOrigins,identityHash,randomIdentityValue} from '@/lib/central-identity';
import {safeCentralNext} from '@/lib/central-navigation';
import {linkCentralAccount} from '@/lib/central-account-link';

export const runtime='nodejs';
export async function POST(req:NextRequest,{params}:{params:Promise<{action:string}>}) {
  const headers={'Cache-Control':'no-store'};
  if(!centralEnabled() || (await params).action!=='access')return new NextResponse(null,{status:404,headers});
  try{
    const body=await req.json();
    if(typeof body.ticket!=='string' || body.ticket.length>4096)return NextResponse.json({error:'Autorização inválida.'},{status:401,headers});
    const verified=await centralRequest<{target:{id:string;name:string;email:string;active:boolean;role:string};link:{crmUserId:string;enabled:boolean}|null;operation:'inspect'|'enable'}>('/identity/access-admin',{ticket:body.ticket});
    const {target,link}=verified;
    const rows=await prisma.user.findMany({where:link?{id:link.crmUserId}:{email:{equals:target.email.trim().toLowerCase(),mode:'insensitive'}},take:2,
      select:{id:true,name:true,email:true,role:true,active:true,deletedAt:true,centralIdentityLink:{select:{attendanceUserId:true,enabled:true}}}});
    const account=rows.length===1?rows[0]:null;
    const eligible=Boolean(account?.active && !account.deletedAt && account.role!=='REPRESENTANTE' && target.active && target.role!=='BOT' &&
      (!account.centralIdentityLink || account.centralIdentityLink.attendanceUserId===target.id));
    if(verified.operation==='enable'){
      if(!account || !eligible)return NextResponse.json({error:'Conta CRM ausente, inativa, representante ou vinculada a outra pessoa.'},{status:409,headers});
      await linkCentralAccount(account,target.id);
      return NextResponse.json({status:'LINKED'},{headers});
    }
    return NextResponse.json({enabled:Boolean(link?.enabled),effective:Boolean(link?.enabled && eligible && account?.centralIdentityLink?.enabled),eligible,
      account:account?{name:account.name,email:account.email,role:account.role}:null,
      reason:rows.length>1?'E-mail ambíguo.':!account?'Crie no CRM uma conta com o mesmo e-mail do Atendimento.':!eligible?'Conta inativa, representante ou vínculo incompatível.':null},{headers});
  }catch(error){
    const status=(error as {statusCode?:number}).statusCode;
    return NextResponse.json({error:status===401?'Autorização inválida ou expirada.':'Não foi possível confirmar o vínculo. Atualize para conferir o estado das contas antes de tentar novamente.'},{status:status===401?401:409,headers});
  }
}
const cookie='central_crm_state';
const cookieOptions={httpOnly:true,sameSite:'lax' as const,secure:process.env.NODE_ENV==='production',path:'/api/central',maxAge:120};
const authSecret=()=>process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET||'';
const stateKey=()=>{
  const secret=authSecret();if(secret.length<32)throw Error('Identity state key unavailable');
  return new TextEncoder().encode(`central-crm-flow:v1:${secret}`);
};
export async function GET(req:NextRequest,{params}:{params:Promise<{action:string}>}) {
  if(!centralEnabled())return new NextResponse(null,{status:404});
  const {action}=await params;
  const jar=await cookies();
  const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
  try{
    const origins=identityOrigins();
    if(action==='start'){
      const verifier=randomIdentityValue(),state=randomIdentityValue();
      const saved=await new SignJWT({verifier,state,next:safeCentralNext(req.nextUrl.searchParams.get('next'))}).setProtectedHeader({alg:'HS256'}).setAudience('central-crm-flow').setIssuedAt().setExpirationTime('2m').sign(stateKey());
      jar.set(cookie,saved,cookieOptions);
      const target=new URL('/identity/authorize',origins.attendance);
      target.searchParams.set('state',state);target.searchParams.set('challenge',await identityHash(verifier));
      return NextResponse.redirect(target,{headers});
    }
    if(action==='callback'){
      const {payload}=await jwtVerify(jar.get(cookie)?.value||'',stateKey(),{audience:'central-crm-flow',algorithms:['HS256']});
      jar.set(cookie,'',{...cookieOptions,maxAge:0});
      if(payload.state!==req.nextUrl.searchParams.get('state') || typeof payload.verifier!=='string')throw Error('Invalid identity state');
      await signIn('central-sso',{code:req.nextUrl.searchParams.get('code'),verifier:payload.verifier,redirect:false,redirectTo:'/dashboard'});
      // Check the resulting cookie rather than considering a provider redirect
      // or error URL proof that authentication succeeded.
      // auth() reads the original request cookies; the new login cookie only
      // exists in the mutable response jar until the next browser request.
      const token=await getToken({req:{headers:new Headers({cookie:jar.toString()})},secret:authSecret(),secureCookie:origins.crm.startsWith('https:')});
      if(!token?.id || !token.primaryProof)throw Error('Identity callback failed');
      return NextResponse.redirect(new URL(safeCentralNext(payload.next),origins.crm),{headers});
    }
    if(action==='authorize'){
      const state=req.nextUrl.searchParams.get('state')||'',challenge=req.nextUrl.searchParams.get('challenge')||'';
      if(!/^[A-Za-z0-9_-]{43}$/.test(state)||!/^[A-Za-z0-9_-]{43}$/.test(challenge))throw Error('Invalid identity request');
      const session=await auth();
      if(!session?.user){
        const target=new URL('/login',origins.crm);target.searchParams.set('callbackUrl',req.nextUrl.pathname+req.nextUrl.search);
        return NextResponse.redirect(target,{headers});
      }
      const account=await prisma.user.findUnique({where:{id:session.user.id},include:{centralIdentityLink:true}});
      if(!account?.active||account.deletedAt||account.role==='REPRESENTANTE'||!account.centralIdentityLink?.enabled)return new NextResponse('Sua conta não tem acesso ao Atendimento.',{status:403,headers});
      const token=await getToken({req,secret:authSecret(),secureCookie:origins.crm.startsWith('https:')});
      if(!token?.primaryProof)throw Error('Primary identity required');
      const result=await centralRequest<{code:string}>('/identity/return',{crmUserId:account.id,primaryProof:token.primaryProof,challenge});
      const target=new URL('/identity/callback',origins.attendance);target.searchParams.set('state',state);target.searchParams.set('code',result.code);
      return NextResponse.redirect(target,{headers});
    }
    return new NextResponse(null,{status:404,headers});
  }catch{
    return new NextResponse('Não foi possível validar o acesso compartilhado. Volte à tela de login e tente novamente.',{status:401,headers});
  }
}
