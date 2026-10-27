// WebCrypto keeps the service client independent of the Node/Edge runtime.
const encoder=new TextEncoder();
export const centralEnabled=()=>process.env.CENTRAL_IDENTITY_ENABLED==='true';
const b64=(bytes:Uint8Array)=>Buffer.from(bytes).toString('base64url');
export const randomIdentityValue=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
export const identityHash=async(value:string)=>b64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));
export function identityOrigins() {
  const attendance=new URL(process.env.ATTENDANCE_PUBLIC_URL!),crm=new URL(process.env.CRM_PUBLIC_URL!);
  for(const u of [attendance,crm]) if(u.origin!==u.href.replace(/\/$/,'') || u.username || u.password || (u.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(u.hostname)))throw Error('Invalid identity origin');
  return {attendance:attendance.origin,crm:crm.origin};
}
async function hmac(key:BufferSource,value:string) {
  const imported=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',imported,encoder.encode(value)));
}
export type PrimaryIdentity={attendanceUserId:string;crmUserId:string;primaryProof:string};
export async function centralRequest<T>(path:string,data:unknown):Promise<T> {
  if(!centralEnabled())throw Error('Identity bridge disabled');
  const secret=process.env.CENTRAL_IDENTITY_SECRET;
  if(!secret||secret.length<32||!/^\/identity\/[a-z-]+$/.test(path))throw Error('Identity bridge unavailable');
  const body=JSON.stringify(data),timestamp=Date.now(),nonce=randomIdentityValue();
  const key=await hmac(encoder.encode(secret),'central-identity:v1:service-request');
  const signature=b64(await hmac(key,['POST',path,String(timestamp),nonce,await identityHash(body)].join('\n')));
  const response=await fetch(new URL(path,identityOrigins().attendance),{method:'POST',headers:{'Content-Type':'application/json','x-central-time':String(timestamp),'x-central-nonce':nonce,'x-central-signature':signature},body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(4000)});
  // Rule messages (4xx) are surfaced only by callers that opt in to them.
  if(!response.ok)throw Object.assign(Error('Primary identity validation failed'),{statusCode:response.status,detail:response.status<500?await response.json().then(data=>typeof data?.error==='string'?data.error.slice(0,300):undefined).catch(()=>undefined):undefined});
  return await response.json() as T;
}
