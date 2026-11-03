'use client';
import {useEffect,useState} from 'react';
import type {ContactHistory} from '@/app/api/whatsapp-contacts/route';
type Company={id:string;name:string};
type Contact={id:string;name:string;contactName:string;phone:string;whatsappAllowed:boolean;city:string|null;state:string|null;seller:string;history:ContactHistory};
type Result={contacts:Contact[];total:number;pageSize:number};
const labels:Record<string,string>={ENVIADA:'Enviado',ENTREGUE:'Entregue',LIDA:'Lido',FALHOU:'Falhou',PENDENTE:'Na fila',PENDING:'Na fila',QUEUED:'Na fila',SENDING:'Enviando',SENT:'Enviado',DELIVERED:'Entregue',READ:'Lido',REPLIED:'Respondeu',FAILED:'Falhou',SKIPPED:'Não enviado',OPTED_OUT:'Opt-out'};
const date=(value:string|null)=>value?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'—';
export function WhatsappContacts(){
 const [companies,setCompanies]=useState<Company[]>([]),[companyId,setCompany]=useState(''),[phoneField,setPhoneField]=useState('phoneDigits');
 const [sellers,setSellers]=useState<Company[]>([]),[sellerId,setSeller]=useState('');
 const [q,setQ]=useState(''),[uf,setUf]=useState(''),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0);
 const [stage,setStage]=useState(''),[interest,setInterest]=useState(''),[city,setCity]=useState(''),[hasBought,setHasBought]=useState(false);
 const [data,setData]=useState<Result>({contacts:[],total:0,pageSize:50}),[selected,setSelected]=useState<Set<string>>(new Set()),[skipSent,setSkipSent]=useState(true);
 const [loading,setLoading]=useState(false),[preparing,setPreparing]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const abort=new AbortController();fetch('/api/whatsapp-contacts?options=1',{cache:'no-store',signal:abort.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);setCompanies(d.companies);setSellers(d.sellers||[]);if(d.companies.length===1)setCompany(d.companies[0].id);}).catch(e=>{if(e.name!=='AbortError')setError(e.message||'Não foi possível carregar suas empresas.');});return()=>abort.abort();},[]);
 useEffect(()=>{
  if(!companyId)return;const abort=new AbortController();
  const timer=setTimeout(async()=>{setLoading(true);setError('');try{
   const params=new URLSearchParams({companyId,phoneField,page:String(page),q,state:uf,stage,interest,city,...(hasBought?{repurchase:'1'}:{}),...(sellerId?{sellerId}:{})});
   const r=await fetch(`/api/whatsapp-contacts?${params}`,{cache:'no-store',signal:abort.signal}),result=await r.json();if(!r.ok)throw Error(result.error);setData(result);
  }catch(e){if(!abort.signal.aborted){setData({contacts:[],total:0,pageSize:50});setError(e instanceof Error?e.message:'Falha ao sincronizar.');}}finally{if(!abort.signal.aborted)setLoading(false);}},250);
  return()=>{clearTimeout(timer);abort.abort();};
 },[companyId,phoneField,page,q,uf,sellerId,refresh,stage,interest,city,hasBought]);
 useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible'&&navigator.onLine)setRefresh(n=>n+1);},30000);return()=>clearInterval(timer);},[]);
 const eligible=(row:Contact)=>row.whatsappAllowed&&Boolean(row.history?.phone)&&!row.history.optedOut&&!row.history.queued&&(!skipSent||!row.history.hasSent);
 function toggle(id:string){setSelected(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else if(next.size<500)next.add(id);return next;});}
 async function prepare(){
  setPreparing(true);setError('');try{const r=await fetch('/api/whatsapp-contacts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId,phoneField,ids:[...selected],skipSent})}),result=await r.json();if(!r.ok)throw Error(result.error);
   if(window.top)window.top.location.href=result.nextUrl;else location.href=result.nextUrl;
  }catch(e){setError(e instanceof Error?e.message:'Falha ao preparar seleção.');setPreparing(false);}
 }
 return <section className="space-y-5">
  <div><h1 className="text-2xl font-semibold text-gray-900">WhatsApp · contatos do CRM</h1><p className="text-sm text-gray-500 mt-1">Escolha a empresa, selecione sua carteira e revise número e templates na Central. Nada é enviado nesta tela.</p></div>
  <div className="card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
   <label className="text-sm">Empresa do envio<select aria-label="Empresa do envio" className="input-field mt-1" value={companyId} onChange={e=>{setCompany(e.target.value);setSelected(new Set());setData({contacts:[],total:0,pageSize:50});setPage(1);}}><option value="">Escolha a empresa</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <label className="text-sm">Buscar contato<input aria-label="Buscar contato" className="input-field mt-1" value={q} onChange={e=>{setQ(e.target.value);setPage(1);}} placeholder="Nome, empresa ou telefone"/></label>
   <label className="text-sm">UF<input aria-label="UF" className="input-field mt-1" value={uf} maxLength={2} onChange={e=>{setUf(e.target.value.toUpperCase());setPage(1);}} placeholder="Todas"/></label>
   <label className="text-sm">Responsável<select aria-label="Responsável" className="input-field mt-1" value={sellerId} onChange={e=>{setSeller(e.target.value);setPage(1);}}><option value="">Todos no meu acesso</option>{sellers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <label className="text-sm">Telefone do cadastro<select aria-label="Telefone do cadastro" className="input-field mt-1" value={phoneField} onChange={e=>{setPhoneField(e.target.value);setSelected(new Set());setPage(1);}}><option value="phoneDigits">Principal</option><option value="phone2Digits">Segundo telefone</option><option value="phone3Digits">Terceiro telefone</option></select></label>
   <label className="text-sm">Etapa comercial<select aria-label="Etapa comercial" className="input-field mt-1" value={stage} onChange={e=>{setStage(e.target.value);setSelected(new Set());setPage(1);}}><option value="">Todas as etapas</option>{[['NOVO','Novos'],['EM_ATENDIMENTO','Em atendimento'],['FOLLOW_UP','Follow-up'],['COTACAO','Cotação'],['VENDIDO','Vendidos'],['RECICLAGEM','Reciclagem'],['INATIVO','Inativos']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   <label className="text-sm">Interesse em produto<select aria-label="Interesse em produto" className="input-field mt-1" value={interest} onChange={e=>{setInterest(e.target.value);setSelected(new Set());setPage(1);}}><option value="">Todos os produtos</option><option value="SMARTWATCH">Smartwatch</option><option value="OCULOS_IA">Óculos IA</option><option value="FONE_DE_OUVIDO">Fone de ouvido</option></select></label>
   <label className="text-sm">Cidade<input aria-label="Cidade" className="input-field mt-1" value={city} onChange={e=>{setCity(e.target.value);setSelected(new Set());setPage(1);}} placeholder="Todas as cidades"/></label>
   <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hasBought} onChange={e=>{setHasBought(e.target.checked);setSelected(new Set());setPage(1);}}/>Somente clientes com compra registrada</label>
  </div>
  <div className="flex flex-wrap items-center justify-between gap-3">
   <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={skipSent} onChange={e=>{setSkipSent(e.target.checked);setSelected(new Set());}}/>Ignorar contatos com envio registrado nesta empresa</label>
   <button className="btn-secondary text-sm" disabled={loading||!companyId} onClick={()=>setRefresh(n=>n+1)}>Atualizar histórico</button>
  </div>
  <p className="text-xs text-gray-500">Histórico por telefone ou vínculo do CRM, separado por empresa. Master consulta o escopo permitido; os demais consultam os próprios envios. Sem registro não significa que nunca houve contato. Ter telefone cadastrado não comprova consentimento. Campos marcados “somente telefone” não entram no envio.</p>
  {error&&<p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  {data.contacts.some(row=>row.history?.crossCompany?.contactedElsewhere)?<aside role="status" className="rounded-xl border border-amber-300 p-4 text-sm"><h2 className="font-medium">Contatos já chamados por outra empresa</h2><p className="mt-1 text-xs text-gray-500">Apenas um aviso: você pode continuar. Isso não confirma entrega nem resposta e não libera acesso a conversas da outra empresa.</p><ul className="mt-2 space-y-1">{data.contacts.filter(row=>row.history?.crossCompany?.contactedElsewhere).map(row=><li key={row.id}>{row.name} · {row.phone} · {row.history.crossCompany?.companies.length?row.history.crossCompany.companies.join(', '):'Outra empresa (acesso restrito)'}</li>)}</ul></aside>:null}
  {!companyId?<div className="card p-8 text-sm text-gray-500">Selecione a empresa para consultar o histórico e preparar o envio.</div>:<div className="card overflow-x-auto" aria-busy={loading}>
   <table className="min-w-full text-sm"><thead><tr className="border-b border-gray-200 text-left text-xs text-gray-500"><th className="p-3">Selecionar</th><th className="p-3">Contato / carteira</th><th className="p-3">Telefone</th><th className="p-3">Último registro</th><th className="p-3">Número e atendente</th></tr></thead>
   <tbody>{data.contacts.map(row=><tr key={row.id} className="border-b border-gray-100"><td className="p-3"><input type="checkbox" aria-label={`Selecionar ${row.name}`} checked={selected.has(row.id)} disabled={loading||!eligible(row)} onChange={()=>toggle(row.id)}/></td><td className="p-3"><strong className="block font-medium">{row.name}</strong><span className="text-xs text-gray-500">{row.seller} · {[row.city,row.state].filter(Boolean).join(' / ')}</span></td><td className="p-3 whitespace-nowrap">{row.phone||'Sem telefone'}</td><td className="p-3"><span className="block">{row.history?.optedOut?'Não deseja mensagens':row.history?.lastStatus?labels[row.history.lastStatus]||row.history.lastStatus:'Sem registro no seu acesso'}</span><span className="text-xs text-gray-500">{date(row.history?.lastEventAt || row.history?.lastSentAt)}{row.history?.templateName?` · ${row.history.templateName}`:''}</span>{row.history?.hasSent&&<span className="block text-xs text-gray-500">Já houve envio nesta empresa</span>}</td><td className="p-3"><span className="block">{row.history?.senderName||'—'} {row.history?.senderPhone||''}</span><span className="text-xs text-gray-500">{row.history?.agentName||'Origem não registrada'}</span></td></tr>)}</tbody></table>
   {!data.contacts.length&&<p role="status" className="p-6 text-sm text-gray-500">{loading?'Sincronizando contatos e histórico…':'Nenhum contato com este telefone e filtros na sua carteira.'}</p>}
  </div>}
  <div className="flex flex-wrap justify-between items-center gap-3">
   <div className="flex items-center gap-2"><button className="btn-secondary text-sm" disabled={loading||page<=1} onClick={()=>setPage(n=>n-1)}>Anterior</button><span className="text-sm text-gray-500">Página {page} · {data.total} contatos</span><button className="btn-secondary text-sm" disabled={loading||page*50>=data.total} onClick={()=>setPage(n=>n+1)}>Próxima</button></div>
   <div className="flex flex-wrap gap-2"><button className="btn-secondary text-sm" disabled={loading||!companyId} onClick={()=>setSelected(previous=>new Set([...previous,...data.contacts.filter(eligible).map(row=>row.id)].slice(0,500)))}>Selecionar elegíveis da página</button><button className="btn-secondary text-sm" onClick={()=>setSelected(new Set())}>Limpar ({selected.size})</button><button className="btn-primary text-sm" disabled={!selected.size||loading||preparing||!companyId} onClick={prepare}>{preparing?'Preparando…':`Revisar ${selected.size} na Central`}</button></div>
  </div>
 </section>;
}
