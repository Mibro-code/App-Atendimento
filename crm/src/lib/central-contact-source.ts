import 'server-only';
import {NextRequest} from 'next/server';
import {centralSession} from './central-session';
import {centralRequest,identityOrigins} from './central-identity';
export type CentralContactSource={id:string;contactId:string;name:string;phones:string[];company:{id:string;name:string;slug:string}};
export async function centralContactSource(req:NextRequest,user:{id:string;role:string},conversationId:string){
  if(req.headers.get('origin')!==identityOrigins().crm)throw Error('Untrusted mutation origin');
  const context=await centralSession(req,user);
  if(!context)throw Error('Integrated access unavailable');
  return centralRequest<CentralContactSource>('/identity/conversation-context',{...context,conversationId,forImport:true});
}
export const contactLinkKey=(source:CentralContactSource)=>({attendanceCompanyId:source.company.id,attendanceContactId:source.contactId});
export function exactPhoneVariants(values:string[]){
  return [...new Set(values.flatMap(value=>{
    let p=value.replace(/\D/g,'');if(p.length===10||p.length===11)p='55'+p;
    if(!/^\d{10,15}$/.test(p))return [];
    const list=[p],nine=p.match(/^55(\d{2})9([6-9]\d{7})$/),old=p.match(/^55(\d{2})([6-9]\d{7})$/);
    if(nine)list.push(`55${nine[1]}${nine[2]}`);if(old)list.push(`55${old[1]}9${old[2]}`);
    return list.flatMap(phone=>/^55\d{10,11}$/.test(phone)?[phone,phone.slice(2)]:[phone]);
  }))];
}
