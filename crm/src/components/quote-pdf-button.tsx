'use client';
import {useRef,useState} from 'react';
export function QuotePdfButton({quoteId}:{quoteId:string}){
  const lock=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function download(){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try{
      const response=await fetch(`/api/quotes/${encodeURIComponent(quoteId)}/pdf`,{cache:'no-store'});
      if(!response.ok){const body=await response.json().catch(()=>null);throw Error(body?.error||'Não foi possível baixar a proposta.');}
      if(!response.headers.get('Content-Type')?.includes('application/pdf'))throw Error('Sua sessão pode ter expirado. Entre novamente para baixar a proposta.');
      const blob=await response.blob();if(!blob.size)throw Error('Não foi possível baixar a proposta.');
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`proposta-${quoteId.slice(-6).toUpperCase()}.pdf`;document.body.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível baixar a proposta.');}finally{lock.current=false;setBusy(false);}
  }
  return <div className="space-y-2"><button type="button" className="btn-secondary whitespace-nowrap" onClick={download} disabled={busy} aria-busy={busy}>{busy?'Gerando PDF…':'Baixar proposta em PDF'}</button>{error?<p role="alert" className="max-w-sm text-xs text-red-600">{error}</p>:null}</div>;
}
