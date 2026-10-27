// Strict allowlist: never transport an arbitrary redirect through SSO.
export function safeCentralNext(value:unknown):string {
  if(typeof value!=='string')return '/dashboard';
  if(value==='/central-resume')return value;
  if(/^\/clientes\/[A-Za-z0-9_-]{1,128}$/.test(value))return value;
  if(/^\/clientes\/novo\?conversationId=[A-Za-z0-9_-]{1,128}$/.test(value))return value;
  if(/^\/cotacoes\/[A-Za-z0-9_-]{1,128}$/.test(value))return value;
  if(/^\/cotacoes\/nova\?cliente=[A-Za-z0-9_-]{1,128}&marca=(mibro|sincrofit)$/.test(value))return value;
  if(/^\/central-context\?conversationId=[A-Za-z0-9_-]{1,128}$/.test(value))return value;
  if(/^\/central-import\?conversationId=[A-Za-z0-9_-]{1,128}$/.test(value))return value;
  if(/^\/central-center\?company=(mibro|sincrofit)&mode=(search|notifications)$/.test(value))return value;
  if(/^\/central-activities\?company=(mibro|sincrofit)$/.test(value))return value;
  if(/^\/agenda\?open=[A-Za-z0-9_-]{1,64}$/.test(value))return value;
  if(value==='/follow-ups?tab=atrasados')return value;
  return '/dashboard';
}
