import {CentralCenter} from '@/components/central-center';
export default async function CenterPage({searchParams}:{searchParams:Promise<{company?:string;mode?:string}>}){
  const {company,mode}=await searchParams;
  return <CentralCenter company={company||''} mode={mode==='notifications'?'notifications':'search'}/>;
}
