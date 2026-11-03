import {Suspense} from 'react';
import {redirect} from 'next/navigation';
import {auth} from '@/auth';
import {CentralViewState} from '@/components/central-view-state';
export default async function ResumePage(){
  const session=await auth();if(!session?.user)redirect('/login');
  return <Suspense fallback={null}><CentralViewState identity={session.user.id+':'+session.user.role} resume/></Suspense>;
}
