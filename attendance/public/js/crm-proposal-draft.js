(()=>{
  let current=null;
  function clear(){current=null;document.querySelector('#crm-proposal-draft-notice').hidden=true;}
  document.querySelector('#clear-crm-proposal-draft').addEventListener('click',clear);
  document.querySelector('#message-input').addEventListener('input',event=>{if(!event.target.value.trim())clear();});
  window.CrmProposalDraft={
    payload(conversationId){return current?.conversationId===conversationId?{crmProposalDraft:current.code}:{};},
    sent(conversationId){if(current?.conversationId===conversationId)clear();},clear
  };
  async function open(){
    const code=new URLSearchParams(location.hash.slice(1)).get('crmProposal');if(!code)return;
    history.replaceState(null,'',location.pathname+location.search);
    try{
      const data=await api('/identity/proposal',{method:'POST',body:JSON.stringify({code})});
      const dialog=document.createElement('dialog');dialog.className='crm-proposal-review';
      const title=document.createElement('h2');title.textContent='Revisar resumo da proposta';
      const info=document.createElement('p');info.textContent=`Empresa: ${data.company.name} · Cliente: +${data.phone}. Nenhuma mensagem foi enviada. A janela de 24 horas e as permissões serão revalidadas no envio.`;
      const summary=document.createElement('textarea');summary.value=data.text;summary.readOnly=true;summary.rows=10;summary.setAttribute('aria-label','Resumo da proposta');
      const select=document.createElement('select');select.setAttribute('aria-label','Conversa para preparar proposta');
      for(const row of data.conversations){const option=document.createElement('option');option.value=row.id;option.textContent=`${row.channelAccount?.name||'Número não registrado'} · ${row.assignedUser?.name||'Sem responsável'}`;select.append(option);}
      const prepare=document.createElement('button');prepare.type='button';prepare.textContent='Abrir conversa e preparar mensagem';prepare.disabled=!data.conversations.length;
      if(!data.conversations.length)info.textContent+=' Não há conversa operacional permitida. Inicie uma conversa pela empresa correta com template aprovado e retome após a resposta do cliente.';
      prepare.addEventListener('click',async()=>{prepare.disabled=true;try{await openConversationInWorkspace(select.value);const input=document.querySelector('#message-input');if(input.value.trim()&&!confirm('Substituir o rascunho atual pelo resumo da proposta?')){prepare.disabled=false;return;}input.value=data.text;input.dispatchEvent(new Event('input',{bubbles:true}));current={code,conversationId:select.value};document.querySelector('#crm-proposal-draft-notice').hidden=false;dialog.close();dialog.remove();toast('Resumo preparado. Confira e clique em Enviar quando a janela permitir.');}catch(e){toast(e.message,true);prepare.disabled=false;}});
      const close=document.createElement('button');close.type='button';close.textContent='Cancelar';close.addEventListener('click',()=>{dialog.close();dialog.remove();});
      dialog.append(title,info,summary,select,prepare,close);document.body.append(dialog);dialog.showModal();
    }catch(e){toast(e.message,true);}
  }
  // Wait for the existing auth/workspace loader, without loading any CRM bundle.
  let opened=false;document.addEventListener('central:workspace-changed',event=>{if(event.detail?.initial&&!opened){opened=true;open();}});
})();
