'use client';
import {useEffect,useState} from 'react';
type Group={title:string;items:{id:string;label:string;detail?:string;href:string;at?:string}[]};
export function CentralCenter({company,mode}:{company:string;mode:'search'|'notifications'}){
  const [ready,setReady]=useState(false);
  useEffect(()=>setReady(true),[]);
  const [selectedCompany,setSelectedCompany]=useState(company),[companies,setCompanies]=useState<{slug:string;name:string}[]>([]);
  useEffect(()=>{
    if(company)return;
    const controller=new AbortController();
    fetch('/api/attendance-context?options=1',{cache:'no-store',signal:controller.signal}).then(async response=>{if(response.ok)setCompanies((await response.json()).companies);}).catch(()=>{});
    return ()=>controller.abort();
  },[company]);
  const [q,setQ]=useState(''),[groups,setGroups]=useState<Group[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setGroups([]);setError('');setBusy(false);
    if(!selectedCompany||(mode==='search'&&q.trim().length<2))return ()=>controller.abort();
    const timer=setTimeout(()=>{
      setBusy(true);
      fetch('/api/central-center?'+new URLSearchParams({company:selectedCompany,mode,q}),{cache:'no-store',signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error||'Consulta indisponível.');setGroups(data.groups);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    },mode==='search'?300:0);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[selectedCompany,mode,q,retry]);
  return <main className="min-h-screen bg-[#1b2026] p-5 text-sm text-[#e5e9ed]"><header className="flex items-center justify-between gap-3"><h1 className="text-lg font-semibold">{mode==='search'?'Busca integrada':'Central de avisos'}</h1><button onClick={()=>setRetry(n=>n+1)} disabled={busy} className="rounded-lg border border-white/20 px-3 py-2">Atualizar</button></header><p className="my-3 text-xs opacity-60">Atendimento: {selectedCompany.toUpperCase()||'selecione a empresa'} · CRM: sua carteira permitida. Consultas sob demanda; não altera leituras nem dispara novos avisos.</p>
    {!company?<label>Empresa do atendimento<select value={selectedCompany} onChange={event=>setSelectedCompany(event.target.value)} className="my-3 block w-full rounded-lg border border-white/20 bg-[#111519] p-3"><option value="">Selecione a empresa</option>{companies.map(item=><option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>:null}
    {mode==='search'?<label className="block">Buscar nome, telefone, proposta ou pedido<input type="search" disabled={!ready} value={q} onChange={e=>setQ(e.target.value)} maxLength={100} className="my-3 block w-full rounded-lg border border-white/20 bg-[#111519] p-3"/></label>:null}
    {busy?<p role="status">Consultando…</p>:null}{error?<p role="alert">{error}</p>:null}
    {groups.map(group=><section key={group.title} className="my-5"><h2 className="mb-2 font-medium">{group.title}</h2>{group.items.length?<ul className="space-y-2">{group.items.map(item=><li key={item.id}><a href={item.href} target="_top" className="block rounded-xl border border-white/15 p-3 hover:border-orange-500/50"><span>{item.label}</span>{item.detail?<small className="mt-1 block opacity-60">{item.detail}</small>:null}{item.at?<time className="mt-1 block text-xs opacity-60">{new Date(item.at).toLocaleString('pt-BR')}</time>:null}</a></li>)}</ul>:<p className="text-xs opacity-50">Nenhum resultado disponível no seu acesso.</p>}</section>)}
  </main>;
}
