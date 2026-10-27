import {redirect} from 'next/navigation';
import {auth} from '@/auth';
import {centralEnabled} from '@/lib/central-identity';
import {WhatsappContacts} from './whatsapp-contacts';
export default async function Page(){
  const session=await auth();if(!session?.user)redirect('/login');
  if(!centralEnabled()||session.user.role==='REPRESENTANTE')redirect('/dashboard');
  return <WhatsappContacts/>;
}
