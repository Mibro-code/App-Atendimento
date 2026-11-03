(()=>{
 const $=s=>document.querySelector(s);let cursor=null,sequence=0,loading=false;
 async function api(url){const r=await fetch(url,{cache:'no-store'});if(r.status===401){location.replace('/login.html');throw Error('Sessão encerrada.');}const body=await r.json();if(!r.ok)throw Error(body.error||'Consulta indisponível.');return body;}
 async function load(more=false){
  const request=++sequence;loading=true;$('#archive-more').disabled=true;$('#archive-status').textContent='Carregando…';
  if(!more){cursor=null;$('#archive-list').replaceChildren();$('#archive-more').hidden=true;}
  const params=new URLSearchParams({archived:'true',limit:'50',respectHidden:'false',company:$('#archive-company').value,search:$('#archive-search').value.trim()});if(cursor)params.set('cursor',cursor);
  try{
   const body=await api('/api/conversations?'+params);if(request!==sequence)return;
   for(const item of body.items){
    const row=document.createElement('article');row.className='archive-item';
    const info=document.createElement('div'),name=document.createElement('h2'),detail=document.createElement('p'),link=document.createElement('a');
    name.textContent=item.contact.customName||item.contact.name||item.contact.email||item.contact.phone||'Contato';
    detail.textContent=[item.contact.phone||item.contact.email,item.category?.name||'Sem categoria',item.assignedUser?.name||'Sem responsável'].filter(Boolean).join(' · ');
    link.textContent='Ver conversa e detalhes';link.href='/?conversation='+encodeURIComponent(item.id);
    info.append(name,detail);row.append(info,link);$('#archive-list').append(row);
   }
   cursor=body.nextCursor;$('#archive-more').hidden=!cursor;$('#archive-status').textContent=body.total?`${body.total} conversa(s) arquivada(s)`:'Nenhuma conversa arquivada neste filtro.';
  }catch(error){if(request===sequence)$('#archive-status').textContent=error.message;}finally{if(request===sequence){loading=false;$('#archive-more').disabled=false;}}
 }
 $('#archive-filters').addEventListener('submit',e=>{e.preventDefault();load();});$('#archive-company').addEventListener('change',()=>load());$('#archive-more').addEventListener('click',()=>{if(!loading)load(true);});
 (async()=>{await window.CompanyContext.load();for(const company of window.CompanyContext.companies){const option=document.createElement('option');option.value=company.slug;option.textContent=company.name;$('#archive-company').append(option);}$('#archive-company').value=window.CompanyContext.workspace();await load();})().catch(error=>{$('#archive-status').textContent=error.message;});
})();
