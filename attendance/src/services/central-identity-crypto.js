// Dormant primitives: no routes are exposed until the bridge is configured.
const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('base64url');
const opaque = () => randomBytes(32).toString('base64url');
const equal = (a,b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left=Buffer.from(a),right=Buffer.from(b);
  return left.length===right.length && timingSafeEqual(left,right);
};
function key(secret,purpose) {
  if (typeof secret !== 'string' || secret.length < 32) throw Error('Identity signing key unavailable');
  return createHmac('sha256',secret).update(`central-identity:v1:${purpose}`).digest();
}
function proof(secret,claims,now=Date.now()) {
  if (!claims.attendanceUserId || !claims.crmUserId || !Number.isSafeInteger(claims.sessionVersion)) throw Error('Invalid identity');
  const payload=Buffer.from(JSON.stringify({aud:'crm',sub:claims.attendanceUserId,crm:claims.crmUserId,sv:claims.sessionVersion,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+43200})).toString('base64url');
  return `${payload}.${createHmac('sha256',key(secret,'primary-proof')).update(payload).digest('base64url')}`;
}
function readProof(secret,token,now=Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > 4096) return null;
    const parts=token.split('.');
    if(parts.length!==2 || !equal(parts[1],createHmac('sha256',key(secret,'primary-proof')).update(parts[0]).digest('base64url'))) return null;
    const p=JSON.parse(Buffer.from(parts[0],'base64url'));
    const time=Math.floor(now/1000);
    return p.aud==='crm' && typeof p.sub==='string' && p.sub && typeof p.crm==='string' && p.crm && Number.isSafeInteger(p.sv) && Number.isSafeInteger(p.iat) && p.iat<=time && p.exp>time && p.exp-p.iat===43200 ? p : null;
  } catch { return null; }
}
function requestSignature(secret,{method,path,body='',timestamp,nonce}) {
  if (!/^\/[a-z0-9/_-]+$/.test(path) || !['POST'].includes(method) || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) throw Error('Invalid service request');
  return createHmac('sha256',key(secret,'service-request')).update([method,path,String(timestamp),nonce,hash(body)].join('\n')).digest('base64url');
}
async function verifyRequest(secret,request,consumeNonce,now=Date.now()) {
  try {
    if (!Number.isSafeInteger(request.timestamp) || Math.abs(now-request.timestamp)>60000) return false;
    if (!equal(request.signature,requestSignature(secret,request))) return false;
    // Caller must atomically persist a unique nonce across workers/restarts.
    return await consumeNonce(request.nonce,new Date(now+120000)) === true;
  } catch { return false; }
}
module.exports={hash,opaque,equal,proof,readProof,requestSignature,verifyRequest};
