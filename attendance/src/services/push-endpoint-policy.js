const PROVIDERS=new Set(['fcm.googleapis.com','updates.push.services.mozilla.com','push.services.mozilla.com','web.push.apple.com','wns.windows.com']);
function validatedPushEndpoint(endpoint) {
  let url;
  try{url=new URL(endpoint);}catch{throw invalid();}
  const host=url.hostname.toLowerCase();
  // Provider-owned subdomains only; never accept a user-selected origin.
  const provider=PROVIDERS.has(host)||host.endsWith('.push.apple.com')||host.endsWith('.notify.windows.com')||host.endsWith('.push.services.mozilla.com');
  if(typeof endpoint!=='string'||endpoint.length>4096||url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||url.hash||!provider)throw invalid();
  return url.href;
}
function invalid(){return Object.assign(new Error('Destino de notificação push não permitido.'),{statusCode:400});}
module.exports={validatedPushEndpoint};
