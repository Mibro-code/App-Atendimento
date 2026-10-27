import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/prisma";
import { countTodayPendingAppointments } from "@/lib/agenda";
import {centralEnabled,identityOrigins} from '@/lib/central-identity';
import {Suspense} from 'react';
import {CentralViewState} from '@/components/central-view-state';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const account = await prisma.user.findFirst({
    where: { id: session.user.id, active: true, deletedAt: null },
    select: { name: true, email: true, role: true, ...(centralEnabled()?{centralIdentityLink:{select:{enabled:true}}}:{}) },
  });
  if (!account) redirect("/login?error=account-disabled");
  const agendaBadge = await countTodayPendingAppointments(session.user.id);
  const attendanceUrl=centralEnabled() && account.role!=='REPRESENTANTE' && account.centralIdentityLink?.enabled ? new URL('/identity/start',identityOrigins().attendance).href : undefined;

  return (
    <AppShell userName={account.name ?? account.email ?? "Usuário"} userRole={account.role} agendaBadge={agendaBadge} attendanceUrl={attendanceUrl}>
      <Suspense fallback={null}><CentralViewState identity={session.user.id+':'+account.role}/></Suspense>
      {children}
    </AppShell>
  );
}
