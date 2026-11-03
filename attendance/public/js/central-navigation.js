// No CRM iframe or bundle loads while attending conversations.
fetch('/identity/options',{cache:'no-store'}).then(async response=>{
  if(!response.ok)return;
  const data=await response.json();
  if(!data.crmAvailable)return;
  if(data.crmOrigin)window.CrmContext?.enable(data.crmOrigin);
  const link=document.createElement('a');link.href='/crm?connect=1';link.textContent='CRM';link.className='user-button';link.setAttribute('aria-label','Abrir Portal Comercial');
  document.querySelector('#user-button')?.before(link);
  const dialog=document.createElement('dialog');dialog.className='contact-files-dialog';dialog.setAttribute('aria-label','Busca e avisos integrados');
  const close=document.createElement('button');close.type='button';close.textContent='Fechar';close.className='user-button';
  close.addEventListener('click',()=>dialog.close());dialog.append(close);document.body.append(dialog);
  dialog.addEventListener('close',()=>dialog.querySelector('iframe')?.remove());
  const controls=[];
  // Central de Atividades: Agenda do CRM + retornos desta Central, consultados sob demanda.
  for(const [label,next] of [['Atividades',company=>`/central-activities?company=${company}`],['Busca integrada',company=>`/central-center?company=${company}&mode=search`],['Avisos',company=>`/central-center?company=${company}&mode=notifications`]]){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.className='user-button';
    button.addEventListener('click',()=>{
      const company=window.CentralWorkspace?.current()?.slug;if(!company)return;
      const target=new URL('/api/central/start',data.crmOrigin);target.searchParams.set('next',next(company));
      dialog.dataset.company=company;dialog.querySelector('iframe')?.remove();const frame=document.createElement('iframe');frame.title=label;frame.referrerPolicy='no-referrer';frame.src=target.href;frame.style.cssText='width:100%;flex:1;min-height:0;border:0;display:block';dialog.append(frame);dialog.showModal();
    });link.before(button);controls.push(button);
  }
  controls.push(link);
  // Compact headers keep every action, but avoid four new full-width
  // controls pushing the company picker/account outside the viewport.
  if(window.matchMedia){
    const menu=document.createElement('details');menu.className='central-integration-menu';
    const summary=document.createElement('summary');summary.textContent='CRM';summary.setAttribute('aria-label','CRM, atividades e busca integrada');
    const panel=document.createElement('div');panel.className='central-integration-menu-panel';menu.append(summary,panel);
    const user=document.querySelector('#user-button');user?.before(menu);
    const compact=window.matchMedia('(max-width:1100px)'),mobile=window.matchMedia('(max-width:600px)');
    const extras=['#faq-button','#theme-toggle'].map(selector=>document.querySelector(selector)).filter(Boolean).map(node=>{const marker=document.createComment('compact integrated menu');node.before(marker);return {node,marker};});
    function arrange(){
      menu.open=false;
      for(const node of controls){if(compact.matches)panel.append(node);else menu.before(node);}
      for(const {node,marker} of extras){if(mobile.matches)panel.append(node);else marker.after(node);}
    }
    arrange();compact.addEventListener('change',arrange);mobile.addEventListener('change',arrange);
    panel.addEventListener('click',event=>{if(event.target.closest('button,a'))menu.open=false;});
    document.addEventListener('click',event=>{if(!menu.contains(event.target))menu.open=false;});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.open){event.stopPropagation();menu.open=false;summary.focus();}},true);
  }
  // The initial event after loading repeats the same workspace: only a real
  // company switch closes the panel (never show one company's data under another).
  document.addEventListener('central:workspace-changed',event=>{
    const company=event.detail?.company?.slug||window.CentralWorkspace?.current()?.slug;
    if(company&&company===dialog.dataset.company)return;
    if(dialog.open)dialog.close();dialog.querySelector('iframe')?.remove();
  });
}).catch(()=>{});
