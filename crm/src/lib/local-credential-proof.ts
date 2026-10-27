import {createHmac,timingSafeEqual} from 'node:crypto';

// Password hashes never leave the server. Bind local JWTs to the exact
// credential authenticated at login, including resets through other routes.
export function localCredentialProof(id:string,passwordHash:string):string {
  const key=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
  if(!key)throw Error('Session secret unavailable');
  return createHmac('sha256',key).update(JSON.stringify(['crm-local-credential-v1',id,passwordHash])).digest('base64url');
}
export function validLocalCredentialProof(proof:unknown,id:string,passwordHash:string):boolean {
  if(typeof proof!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(proof))return false;
  try{return timingSafeEqual(Buffer.from(proof),Buffer.from(localCredentialProof(id,passwordHash)));}catch{return false;}
}
