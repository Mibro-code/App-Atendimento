// No requests or CRM bundle on message updates. Load only on explicit tab open.
(()=>{
  let origin=null,conversationId=null,loaded=null;
  const host=document.querySelector('#crm-context-frame'),status=document.querySelector('#crm-context-status');
  conversationId=host.dataset.conversationId||null;
  const openButton=document.querySelector('#crm-contact-open');
  openButton.addEventListener('click',()=>document.querySelector('[data-context-tab="crm"]').click());
  function show(){
    if(!origin||!conversationId||loaded===conversationId)return;
    const target=new URL('/api/central/start',origin);
    target.searchParams.set('next',`/central-context?conversationId=${conversationId}`);
    const frame=document.createElement('iframe');frame.title='Ficha comercial do cliente no CRM';frame.referrerPolicy='no-referrer';frame.src=target.href;
    host.replaceChildren(frame);status.hidden=true;loaded=conversationId;
  }
  window.CrmContext={
    available(){return Boolean(origin&&conversationId);},
    enable(value){origin=new URL(value).origin;document.querySelector('[data-context-tab="crm"]').hidden=false;const importTab=document.querySelector('[data-files-tab="crm"]');if(importTab)importTab.hidden=false;openButton.hidden=!conversationId;},
    importInto(container,id){
      if(!origin||!id){container.textContent='Selecione uma conversa com acesso integrado ao CRM.';return;}
      if(container.dataset.crmImport===id&&container.querySelector('iframe'))return;
      const target=new URL('/api/central/start',origin);target.searchParams.set('next',`/central-import?conversationId=${id}`);
      const frame=document.createElement('iframe');frame.title='Cadastrar contato no CRM';frame.referrerPolicy='no-referrer';frame.src=target.href;
      frame.style.cssText='display:block;width:100%;height:100%;min-height:0;border:0;color-scheme:dark';
      container.style.overflow='hidden';container.style.padding='0';
      container.replaceChildren(frame);container.dataset.crmImport=id;
    },
    openImport(){
      if(!origin||!conversationId)return;
      const dialog=document.querySelector('#contact-files-dialog');
      document.querySelectorAll('[data-files-tab]').forEach(button=>button.classList.toggle('active',button.dataset.filesTab==='crm'));
      renderContactFiles('crm');
      if(!dialog.open)dialog.showModal();
    },
    select(id){
      if(conversationId===id)return;
      conversationId=id;loaded=null;openButton.hidden=!origin||!id;host.replaceChildren();status.hidden=false;status.textContent=id?'Abra a aba CRM para consultar a ficha comercial.':'Selecione uma conversa WhatsApp para consultar o CRM.';
      if(document.querySelector('.workspace.context-open')&&document.querySelector('[data-context-tab="crm"].active'))show();
    },show
  };
})();
