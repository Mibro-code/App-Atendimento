'use client';
import {useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
const CustomerActions=dynamic(()=>import('./central-customer-actions'),{loading:()=> <p role="status" className="text-xs">Carregando ações…</p>});
const CustomerTimeline=dynamic(()=>import('./customer-timeline'),{loading:()=> <p role="status" className="text-xs">Carregando histórico…</p>});
type Company={id:string;name:string;slug?:string};
type Customer={id:string;contactName:string;tradeName:string|null;email:string|null;city:string|null;state:string|null;stageLabel:string;seller:{name:string};href:string;quotes:{id:string;status:string;totalValueCents:number|null;createdAt:string;brand:string}[]};
type Conversation={id:string;status:string;assignedUser:{name:string}|null;channelAccount:{name:string}|null;updatedAt:string;href:string};
type Data={company?:Company;customers?:Customer[];ambiguous?:boolean;truncated?:boolean;conversations?:Conversation[];createHref?:string};
const statuses:Record<string,string>={NOVO:'Novo',EM_ATENDIMENTO:'Em atendimento',AGUARDANDO_EQUIPE:'Aguardando equipe',AGUARDANDO_CLIENTE:'Aguardando cliente',FINALIZADO:'Finalizado',ABERTA:'Aberta',CALCULADA:'Calculada',ENVIADA:'Enviada',ENVIADA_PARA_ANALISE:'Em análise',CONVERTIDA:'Convertida',CANCELADA:'Cancelada',EXPIRADA:'Expirada'};
const money=(value:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value/100);
export function AttendanceContext({conversationId,customerId,compact=false,currentUser}:{conversationId?:string;customerId?:string;compact?:boolean;currentUser?:{id:string;name:string;role:string}}){
  const [actionsFor,setActionsFor]=useState<string|null>(null);
  const [timelineFor,setTimelineFor]=useState<string|null>(null);
  const [companies,setCompanies]=useState<Company[]>([]),[companyId,setCompanyId]=useState('');
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!customerId)return;
    const controller=new AbortController();
    fetch('/api/attendance-context?options=1',{cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error||'Consulta indisponível.');setCompanies(body.companies);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return ()=>controller.abort();
  },[customerId,retry]);
  useEffect(()=>{
    setData(null);setError('');setBusy(false);
    if(!conversationId&&(!customerId||!companyId))return;
    const controller=new AbortController();setBusy(true);
    const query:Record<string,string>=conversationId?{conversationId}:{customerId:customerId!,companyId};
    fetch('/api/attendance-context?'+new URLSearchParams(query),{cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error||'Consulta indisponível.');setData(body);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return ()=>controller.abort();
  },[conversationId,customerId,companyId,retry]);
  return <section className={compact?'min-h-screen bg-[#1b2026] p-4 text-[#e5e9ed] text-sm':'max-w-3xl space-y-4'} aria-label={compact?'Ficha comercial do CRM':'Conversas do cliente'}>
    <header className="mb-4 flex items-center justify-between gap-2"><div><p className="text-xs uppercase tracking-widest opacity-60">{compact?'CRM · ficha comercial':'Atendimento · WhatsApp'}</p><h1 className="mt-1 text-lg font-semibold">{compact?'Cliente no CRM':'Conversas do cliente'}</h1></div><button type="button" onClick={()=>setRetry(n=>n+1)} disabled={busy} className="rounded-lg border border-current/20 px-3 py-2 text-xs disabled:opacity-50">Atualizar</button></header>
    {customerId?<><label className="block text-sm">Empresa do atendimento<select value={companyId} onChange={e=>setCompanyId(e.target.value)} className="mt-1 block w-full rounded-lg border p-2 text-gray-900"><option value="">Escolha Mibro ou Sincrofit</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><p className="mt-2 text-xs opacity-60">A carteira do CRM é compartilhada. A busca mostra apenas as conversas permitidas na empresa escolhida.</p></>:null}
    {busy?<p role="status" className="my-4 opacity-70">Consultando…</p>:null}
    {error?<p role="alert" className="my-4">{error} Use Atualizar para tentar novamente.</p>:null}
    {data?.company?<p className="mb-3 text-xs opacity-60">Conversa: {data.company.name} · Cadastro: carteira do CRM</p>:null}
    {data?.ambiguous?<p className="mb-4 rounded-lg border border-amber-500/40 p-3 text-xs">Há mais de um cadastro com este telefone. Confira o contato e o vendedor antes de abrir. Nenhum vínculo foi criado automaticamente.</p>:null}
    {data?.customers?.map(customer=><article key={customer.id} className="mb-3 rounded-xl border border-current/15 p-3">
      <h2 className="font-semibold">{customer.tradeName||customer.contactName}</h2>{customer.tradeName?<p className="mt-1 text-xs opacity-70">Contato: {customer.contactName}</p>:null}
      <dl className="my-3 space-y-2 text-xs"><div><dt className="opacity-60">Vendedor no CRM</dt><dd>{customer.seller.name}</dd></div><div><dt className="opacity-60">Etapa comercial</dt><dd>{customer.stageLabel}</dd></div>{customer.email?<div><dt className="opacity-60">E-mail</dt><dd className="break-all">{customer.email}</dd></div>:null}{customer.city||customer.state?<div><dt className="opacity-60">Localidade</dt><dd>{[customer.city,customer.state].filter(Boolean).join(' · ')}</dd></div>:null}</dl>
      <h3 className="mb-2 text-xs font-semibold">Últimas propostas do cliente</h3>{customer.quotes.length?customer.quotes.map(quote=><p key={quote.id} className="my-1 text-xs opacity-80">{quote.brand==='SINCROFIT'?'Sincrofit':'Mibro'} · {new Date(quote.createdAt).toLocaleDateString('pt-BR')} · {statuses[quote.status]||quote.status}{quote.totalValueCents!==null?' · '+money(quote.totalValueCents):''}</p>):<p className="text-xs opacity-60">Sem propostas disponíveis.</p>}
      {conversationId?<a href={new URL(`/crm?connect=1&proposalCustomer=${encodeURIComponent(customer.id)}&proposalConversation=${encodeURIComponent(conversationId)}`,customer.href).href} target="_top" className="mt-3 block rounded-lg border border-orange-500/50 px-3 py-2 text-center text-xs font-medium">Criar proposta →</a>:null}
      <a href={customer.href} target="_top" className="mt-4 inline-block rounded-lg border border-orange-500/50 px-3 py-2 text-xs font-medium">Abrir cadastro no CRM →</a>
      {data.company?<><button type="button" onClick={()=>setTimelineFor(previous=>previous===customer.id?null:customer.id)} aria-expanded={timelineFor===customer.id} className="mt-2 block rounded-lg border border-current/20 px-3 py-2 text-xs">Linha do tempo</button>{timelineFor===customer.id?<CustomerTimeline customerId={customer.id} companyId={data.company.id}/>:null}</>:null}
      {currentUser?<><button type="button" onClick={()=>setActionsFor(previous=>previous===customer.id?null:customer.id)} aria-expanded={actionsFor===customer.id} className="mt-2 block rounded-lg border border-current/20 px-3 py-2 text-xs">Agendar retorno</button>{actionsFor===customer.id?<CustomerActions currentUser={currentUser} customer={{id:customer.id,name:customer.tradeName||customer.contactName}}/>:null}</>:null}
    </article>)}
    {data?.customers?.length===0?<div className="my-4"><p className="opacity-70">Nenhum cadastro correspondente na sua carteira permitida. Isso não confirma que o contato não existe no CRM.</p>{data.createHref?<a href={data.createHref} target="_top" className="mt-3 inline-block rounded-lg border px-3 py-2 text-xs">Revisar cadastro de lead no CRM →</a>:null}</div>:null}
    {data?.truncated?<p className="text-xs opacity-60">Mostrando até 10 cadastros. Confira os demais diretamente no CRM.</p>:null}
    {data?.conversations?.map(conversation=><article key={conversation.id} className="my-3 rounded-xl border p-4"><h2 className="font-medium">{conversation.channelAccount?.name||'Número não registrado'}</h2><p className="mt-1 text-sm opacity-70">{statuses[conversation.status]||conversation.status} · {conversation.assignedUser?.name||'Sem responsável'}</p><p className="mt-1 text-xs opacity-60">Atualizada em {new Date(conversation.updatedAt).toLocaleString('pt-BR')}</p><a href={conversation.href} target="_top" className="mt-3 inline-block text-sm font-medium text-orange-600">Abrir conversa →</a></article>)}
    {data?.conversations?.length===0?<p className="my-4 text-sm opacity-70">Nenhuma conversa disponível nesta empresa e no seu acesso. Nenhuma nova conversa foi criada.</p>:null}
    {compact?<p className="mt-4 text-xs opacity-50">Criar uma proposta não envia mensagens. Vendedor do CRM e responsável pelo atendimento permanecem independentes.</p>:null}
  </section>;
}
