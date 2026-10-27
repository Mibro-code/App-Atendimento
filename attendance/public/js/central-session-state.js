// Tab-scoped, bounded, two-hour state. No tokens, files, audio, or message
// history are persisted. Restored drafts are shown only after API authorization.
(()=>{
  let user=null,drafts=new Map(),saved=null;
  const key=()=>`central-navigation-v1:${user}`;
  const clean=()=>{for(let i=sessionStorage.length-1;i>=0;i--){const name=sessionStorage.key(i);if(name?.startsWith('central-navigation-v1:'))sessionStorage.removeItem(name);}};
  window.CentralSessionState={
    init(id){
      user=id;drafts=new Map();
      try{
        const raw=sessionStorage.getItem(key());clean();saved=raw?JSON.parse(raw):null;
        if(!saved||saved.version!==1||saved.expires<Date.now()){saved=null;return null;}
        drafts=new Map((saved.drafts||[]).filter(row=>Array.isArray(row)&&typeof row[0]==='string'&&typeof row[1]==='string'&&row[1].length<=60000).slice(-15));
        return saved;
      }catch{saved=null;return null;}
    },
    keep(id,text){if(!user||!id)return;if(text&&text.length<=60000){drafts.delete(id);drafts.set(id,text);while(drafts.size>15)drafts.delete(drafts.keys().next().value);}else if(!text)drafts.delete(id);},
    draft(id){return drafts.get(id)||'';},
    forget(id){drafts.delete(id);},
    persist(navigation){if(!user)return;try{sessionStorage.setItem(key(),JSON.stringify({version:1,expires:Date.now()+7200000,drafts:[...drafts],...navigation}));}catch{}},
    clear(){drafts.clear();saved=null;try{clean();}catch{}}
  };
})();
