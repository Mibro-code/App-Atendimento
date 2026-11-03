(()=>{
 let busy=false;
 window.ConversationArchive={markup(c){
  if(c.accessMode==='SUPERVISION'||!/^[a-zA-Z0-9_-]+$/.test(c.id))return '';
  return `<section class="context-detail-block conversation-archive-card" aria-label="Organizar conversa"><div class="archive-card-heading"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1.5"/><path d="M5 8v11h14V8M9 12h6"/></svg><span>${c.archivedAt?'Conversa arquivada':'Organizar conversa'}</span></div><p>${c.archivedAt?'Seu histórico está salvo. Recupere quando quiser voltar a atender.':'Retire da lista de atendimento e mantenha o histórico salvo.'}</p><div class="archive-card-actions"><button class="archive-card-button${c.archivedAt?' archive-card-restore':''}" type="button" data-conversation-archive="${c.id}" data-archived="${Boolean(c.archivedAt)}">${c.archivedAt?'Recuperar conversa':'Arquivar conversa'}</button><a href="/arquivados">Ver arquivados <span aria-hidden="true">↗</span></a></div></section>`;
 }};
 document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-conversation-archive]');if(!button||busy)return;
  const archived=button.dataset.archived!=='true',id=button.dataset.conversationArchive;
  if(archived&&!window.confirm('Arquivar esta conversa? Ela sairá das listas, inclusive Todos. O histórico e novas mensagens serão preservados. Somente a recuperação manual a devolverá à lista.'))return;
  busy=true;button.disabled=true;
  try{
   const response=await fetch(`/api/conversations/${encodeURIComponent(id)}/archive`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({archived})});
   const body=await response.json();if(!response.ok)throw Error(body.error||'Não foi possível alterar o arquivo.');
   document.dispatchEvent(new CustomEvent('central:archive-changed',{detail:{id,archived}}));
  }catch(error){window.alert(error.message);}finally{busy=false;button.disabled=false;}
 });
})();
