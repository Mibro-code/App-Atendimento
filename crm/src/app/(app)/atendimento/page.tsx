import {AttendanceContext} from '@/components/attendance-context';
export default async function AttendancePage({searchParams}:{searchParams:Promise<{customerId?:string}>}){
  const {customerId}=await searchParams;
  return customerId?<AttendanceContext customerId={customerId}/>:<p>Abra um cadastro e selecione “Conversas no Atendimento”.</p>;
}
