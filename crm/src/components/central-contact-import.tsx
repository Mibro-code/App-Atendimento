'use client';
import {useEffect,useState,type FormEvent} from 'react';
type Candidate={id:string;contactName:string;tradeName?:string;seller?:{name:string}};
type Data={linked:boolean;company:{name:string};lead:{name:string;phone:string;origin:string};customers:Candidate[]};
const fields=[['contactName','Nome do contato'],['phoneDigits','WhatsApp'],['email','E-mail'],['tradeName','Nome da empresa'],['cnpjDigits','CNPJ'],['cpfDigits','CPF'],['city','Cidade'],['state','UF']] as const;
export function CentralContactImport({conversationId}:{conversationId:string}){
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[candidates,setCandidates]=useState<Candidate[]>([]);
  const [values,setValues]=useState<Record<string,string>>({}),[fieldErrors,setFieldErrors]=useState<Record<string,string>>({});
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/attendance-context?'+new URLSearchParams({conversationId,import:'1'}),{cache:'no-store',signal:controller.signal}).then(async response=>{
      const body=await response.json();if(!response.ok)throw Error(body.error||'Consulta indisponível.');
      setData(body);setCandidates(body.customers);setValues({contactName:body.lead.name,phoneDigits:body.lead.phone,leadOrigin:body.lead.origin});
    }).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return ()=>controller.abort();
  },[conversationId]);
  async function submit(event:FormEvent){
    event.preventDefault();if(busy)return;setBusy(true);setError('');setFieldErrors({});
    try{
      const response=await fetch('/api/customers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...values,phoneChannel:'WHATSAPP',attendanceConversationId:conversationId})});
      const body=await response.json();
      if(!response.ok){if(body.possibleDuplicates){setCandidates(body.possibleDuplicates);throw Error('Possível cadastro existente. Confira e confirme o vínculo abaixo, sem criar uma cópia.');}setFieldErrors(body.fieldErrors||{});throw Error(body.error||body.message||'Não foi possível salvar.');}
      setSaved(true);
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar.');}finally{setBusy(false);}
  }
  async function link(customer:Candidate){
    if(busy||!window.confirm(`Vincular este contato ao cadastro “${customer.tradeName||customer.contactName}”? Nenhum histórico será mesclado.`))return;
    setBusy(true);setError('');
    try{
      const response=await fetch('/api/central-contact-link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId,customerId:customer.id,confirm:true})});
      const body=await response.json();if(!response.ok)throw Error(body.error||'Não foi possível vincular.');setSaved(true);
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível vincular.');}finally{setBusy(false);}
  }
  return <main className="min-h-screen bg-[#1b2026] p-5 text-sm text-[#e5e9ed]">
    <div className="mx-auto max-w-2xl"><p className="text-xs uppercase tracking-widest opacity-60">Integração · CRM</p><h1 className="mt-2 text-xl font-semibold">Cadastrar contato no CRM</h1><p className="my-3 text-xs opacity-70">Revise os dados. O cliente entra na sua carteira do CRM; nenhuma mensagem é enviada e o responsável do atendimento não muda.</p>
    {error?<p role="alert" className="my-3 rounded-lg border border-amber-500/40 p-3">{error}</p>:null}
    {!data&&!error?<p role="status">Carregando dados do contato…</p>:null}
    {saved?<p role="status" className="my-4 rounded-lg border border-green-500/40 p-4">Contato vinculado ao CRM. Você já pode fechar esta janela e continuar o atendimento.</p>:data?.linked?<p className="my-4">Este contato já está vinculado ao CRM. Consulte a ficha na aba CRM do atendimento; os dados só aparecem para quem tem acesso à carteira.</p>:data?<>
      <p className="mb-4 text-xs opacity-60">Origem: {data.company.name} · Destino: sua carteira do CRM</p>
      {candidates.length?<section className="mb-5 rounded-xl border border-current/20 p-4"><h2 className="font-medium">Confira os cadastros existentes</h2><p className="mt-1 text-xs opacity-60">Telefone semelhante não confirma a identidade. Confirme antes de vincular.</p>{candidates.map(customer=><div key={customer.id} className="mt-3 flex flex-wrap items-center justify-between gap-2"><span>{customer.tradeName||customer.contactName}{customer.seller?<small className="block opacity-60">Vendedor: {customer.seller.name}</small>:null}</span><button disabled={busy} type="button" onClick={()=>link(customer)} className="rounded-lg border border-current/20 px-3 py-2 disabled:opacity-50">Vincular a este cadastro</button></div>)}</section>:null}
      <form onSubmit={submit} className="space-y-4"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{fields.map(([key,label])=><label key={key} className="block text-xs">{label}{key==='contactName'?' *':''}<input name={key} value={values[key]||''} required={key==='contactName'} type={key==='email'?'email':'text'} maxLength={key==='state'?2:200} onChange={event=>setValues(previous=>({...previous,[key]:event.target.value}))} aria-invalid={Boolean(fieldErrors[key])} className="mt-1 block w-full rounded-lg border border-white/20 bg-[#111519] px-3 py-2.5 text-sm"/>{fieldErrors[key]?<span className="mt-1 block text-amber-300">{fieldErrors[key]}</span>:null}</label>)}</div>
      <label className="block text-xs">Observações<textarea name="notes" value={values.notes||''} maxLength={5000} onChange={event=>setValues(previous=>({...previous,notes:event.target.value}))} rows={3} className="mt-1 block w-full rounded-lg border border-white/20 bg-[#111519] px-3 py-2 text-sm"/></label>
      <button disabled={busy} className="rounded-lg bg-[#ec5b26] px-4 py-2.5 font-medium text-white disabled:opacity-50">{busy?'Salvando…':'Enviar para o CRM'}</button></form>
    </>:null}</div>
  </main>;
}
