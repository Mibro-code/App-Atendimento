'use client';
import {ScheduleAppointmentButton} from '@/app/(app)/clientes/[id]/schedule-appointment-button';
export default function CustomerActions({customer,currentUser,proposalHref}:{customer:{id:string;name:string};currentUser:{id:string;name:string;role:string};proposalHref?:string}){
  return <div className="mt-3 space-y-3"><p className="text-xs opacity-60">O retorno será um lembrete interno na agenda do CRM. Nenhuma mensagem automática será enviada.</p><ScheduleAppointmentButton customer={customer} currentUser={currentUser}/>{proposalHref?<a href={proposalHref} target="_top" className="block rounded-lg border px-3 py-2 text-xs">Preparar proposta desta empresa →</a>:null}</div>;
}
