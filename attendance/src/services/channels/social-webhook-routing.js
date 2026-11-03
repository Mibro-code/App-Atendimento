const SOCIAL=new Set(['FACEBOOK_MESSENGER','INSTAGRAM_DIRECT','FACEBOOK_COMMENTS','INSTAGRAM_COMMENTS']);
const fail=statusCode=>Object.assign(new Error('Webhook sem destinatário válido ou assinatura inválida.'),{statusCode});
function ownedPayload(payload,owner){
  const entry=(Array.isArray(payload?.entry)?payload.entry:[]).filter(item=>owner&&String(item.id)===String(owner));
  for(const item of entry)for(const event of item.messaging||[]){
    if(event.message&&!event.message.is_echo&&event.recipient?.id&&String(event.recipient.id)!==String(item.id))throw fail(404);
  }
  return {...payload,entry};
}
function planInboundRouting(channel,candidates,req,makeAdapter){
  const adapters=candidates.map(account=>({account,adapter:makeAdapter(account)}));
  const bodies=SOCIAL.has(channel)?(Array.isArray(req.body?.entry)?req.body.entry.map(entry=>({...req.body,entry:[entry]})):[]):[req.body];
  if(!bodies.length)throw fail(404);
  // Resolve and authenticate every partition BEFORE any persistence occurs.
  return bodies.map(body=>{
    const matches=adapters.filter(({adapter})=>adapter?.matchesWebhookPayload?.(body)||(!SOCIAL.has(channel)&&adapters.length===1));
    if(matches.length!==1)throw fail(404);
    const {account,adapter}=matches[0];
    if(!adapter.capabilities().supportsWebhook)throw fail(404);
    if(!adapter.validateWebhook(req))throw fail(401); // full, original signed rawBody
    return {account,events:adapter.normalizeInboundEvent(body)||[]};
  });
}
module.exports={ownedPayload,planInboundRouting};
