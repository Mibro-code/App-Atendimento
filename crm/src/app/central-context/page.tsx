import {AttendanceContext} from '@/components/attendance-context';
import {auth} from '@/auth';
// Standalone compact view: no AppShell/dashboard/agenda loaded in the inbox.
// Data endpoint independently authenticates and enforces both systems' scopes.
export default async function ContextPage({searchParams}:{searchParams:Promise<{conversationId?:string}>}){
  const {conversationId}=await searchParams;
  const session=await auth();
  const currentUser=session?.user?{id:session.user.id,name:session.user.name||'Você',role:session.user.role}:undefined;
  return <AttendanceContext conversationId={conversationId} compact currentUser={currentUser}/>;
}
