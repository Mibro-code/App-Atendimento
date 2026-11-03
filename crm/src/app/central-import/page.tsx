import {CentralContactImport} from '@/components/central-contact-import';
export default async function ImportPage({searchParams}:{searchParams:Promise<{conversationId?:string}>}){
  const {conversationId}=await searchParams;
  return <CentralContactImport conversationId={conversationId||''}/>;
}
