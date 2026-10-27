// Navigation only, never auth/callback/action endpoints or external URLs.
export function safeCrmViewPath(value:unknown):string|null{
  if(typeof value!=='string'||value.length>2500||!/^\/(dashboard|clientes|cotacoes|vendas|agenda|follow-ups|envios-whatsapp)(\/|\?|$)/.test(value)||/[\r\n\\#]/.test(value))return null;
  const url=new URL(value,'https://local.invalid');
  if(url.origin!=='https://local.invalid'||!/^\/(dashboard|clientes|cotacoes|vendas|agenda|follow-ups|envios-whatsapp)(\/|$)/.test(url.pathname)||/(^|\/)\.{1,2}(\/|$)/.test(value.split('?')[0])||[...url.searchParams.keys()].some(key=>/token|secret|password|callback|redirect/i.test(key)))return null;
  return url.pathname+url.search;
}
