// Test-only fail-closed outbound guard. Never imported by application code.
const http=require('node:http'),https=require('node:https');
const allowed=url=>{const u=new URL(url);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('External network blocked in local integration tests');};
const originalFetch=global.fetch;
global.fetch=(input,options)=>{allowed(typeof input==='string'||input instanceof URL?String(input):input.url);return originalFetch(input,options);};
for(const transport of [http,https]){
 const original=transport.request;
 transport.request=function(input,...rest){
  if(typeof input==='string'||input instanceof URL)allowed(String(input));
  else if(!['127.0.0.1','localhost','::1','[::1]'].includes(input.hostname||input.host))throw Error('External network blocked in local integration tests');
  return original.call(this,input,...rest);
 };
 transport.get=function(...args){const req=transport.request(...args);req.end();return req;};
}
