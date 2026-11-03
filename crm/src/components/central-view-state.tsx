'use client';
import {useEffect} from 'react';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {safeCrmViewPath} from '@/lib/central-view-path';
const prefix='central-crm-view-v1:';
export function CentralViewState({identity,resume=false}:{identity:string;resume?:boolean}){
  const pathname=usePathname(),query=useSearchParams().toString(),router=useRouter();
  useEffect(()=>{
    const key=prefix+identity;
    try{
      for(let i=sessionStorage.length-1;i>=0;i--){const name=sessionStorage.key(i);if(name?.startsWith(prefix)&&name!==key)sessionStorage.removeItem(name);}
      if(resume){
        const data=JSON.parse(sessionStorage.getItem(key)||'null'),path=data?.expires>Date.now()?safeCrmViewPath(data?.path):null;
        router.replace(path||'/dashboard');return;
      }
      const path=safeCrmViewPath(pathname+(query?'?'+query:''));if(!path)return;
      const previous=JSON.parse(sessionStorage.getItem(key)||'null');
      if(previous?.path===path&&previous.expires>Date.now())requestAnimationFrame(()=>window.scrollTo(0,Math.max(0,Number(previous.scroll)||0)));
      const save=()=>{try{sessionStorage.setItem(key,JSON.stringify({path,scroll:window.scrollY,expires:Date.now()+7200000}));}catch{}};
      const click=(event:MouseEvent)=>{if((event.target as Element)?.closest('a'))save();};
      save();window.addEventListener('pagehide',save);document.addEventListener('click',click,true);
      return ()=>{save();window.removeEventListener('pagehide',save);document.removeEventListener('click',click,true);};
    }catch{if(resume)router.replace('/dashboard');}
  },[identity,resume,pathname,query,router]);
  return null;
}
