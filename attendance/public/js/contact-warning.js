(()=>{
  const entries=new Map();let selected=null;
  function text(warnings){
    const relevant=warnings.filter(row=>row.contactedElsewhere);if(!relevant.length)return '';
    const names=[...new Set(relevant.flatMap(row=>row.companies))],restricted=relevant.some(row=>row.restrictedCompany);
    return `${relevant.length===1?'Este número já recebeu contato':'Há '+relevant.length+' números que já receberam contato'} ${names.length?'por '+names.join(', '):'por outra empresa'}${restricted&&names.length?' e por outra empresa com acesso restrito':''}. Confira antes de enviar novamente. Isso não confirma entrega ou resposta.`;
  }
  async function lookup(payload,{reuse=false}={}){
    const key=JSON.stringify(payload),previous=entries.get(key);
    if(reuse&&previous&&Date.now()-previous.at<60000)return previous.promise;
    const entry={at:Date.now(),ack:previous?.ack||false};
    entry.promise=fetch('/api/outbound/contact-warning',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:key,signal:AbortSignal.timeout(5000)}).then(async response=>{if(!response.ok)throw Error('Consulta indisponível');return response.json();});
    entries.set(key,entry);if(entries.size>20)entries.delete(entries.keys().next().value);return entry.promise;
  }
  window.ContactWarning={text,
    async confirm(payload){
      const key=JSON.stringify(payload);
      try{
        const data=await lookup(payload,{reuse:Boolean(payload.conversationId)}),entry=entries.get(key),message=text(data.warnings||[]);
        if(!message||entry?.ack)return true;
        const accepted=window.confirm(message+(data.count>100?`\n${data.count} destinatários sinalizados no total.`:'')+'\n\nDeseja continuar com o envio?');
        if(accepted&&entry)entry.ack=true;return accepted;
      }catch{return window.confirm('Não foi possível verificar contato anterior em outra empresa. Deseja continuar sem essa verificação?');}
    },
    select(conversationId){
      if(selected===conversationId)return;selected=conversationId;
      const banner=document.querySelector('#cross-company-contact-warning');if(!banner)return;
      banner.hidden=true;banner.textContent='';if(!conversationId)return;
      lookup({conversationId},{reuse:true}).then(data=>{if(selected!==conversationId)return;const message=text(data.warnings||[]);banner.textContent=message;banner.hidden=!message;}).catch(()=>{});
    }
  };
})();
