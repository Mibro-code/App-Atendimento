import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLE_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { canUseTimeClock, getBrazilWorkDate } from "@/lib/time-clock";
import { StatusBadge, TemperatureBadge } from "@/components/badges";
import { ProfileForm } from "./profile-form";
import { ChangePasswordForm } from "./change-password-form";
import { TimeClockCard } from "./time-clock-card";
import { PasskeySetupCard } from "./passkey-setup-card";
import { TutorialModal } from "./tutorial-modal";
import {centralEnabled} from '@/lib/central-identity';

export default async function PerfilPage() {
  const session = await auth();
  const me = await prisma.user.findUnique({
    where: { id: session!.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      centralIdentityLink: {select:{id:true}},
      _count: { select: { passkeys: true } },
      sellerProfile: {
        select: { phone: true, whatsapp: true, jobTitle: true },
      },
    },
  });

  if (!me) return null;

  // "Seus clientes" aqui é sempre a carteira direta (sellerId = você mesmo),
  // não o escopo ampliado de supervisor/admin (que já existe em /clientes).
  // Faz sentido nesta tela pessoal mostrar só o que é seu de fato.
  const workDate = getBrazilWorkDate();
  const [myCustomers, todayTimeClockEntries, recentTimeClockEntries] = await Promise.all([
    prisma.customer.findMany({
      where: { sellerId: me.id },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        contactName: true,
        tradeName: true,
        status: true,
        temperature: true,
        lastInteractionAt: true,
      },
    }),
    canUseTimeClock(me.role)
      ? prisma.timeClockEntry.findMany({
          where: { userId: me.id, workDate },
          orderBy: { occurredAt: "asc" },
          select: {
            id: true, eventType: true, occurredAt: true, locationStatus: true,
            latitude: true, longitude: true,
          },
        })
      : Promise.resolve([]),
    canUseTimeClock(me.role)
      ? prisma.timeClockEntry.findMany({
          where: { userId: me.id },
          orderBy: { occurredAt: "desc" },
          take: 28,
          select: {
            id: true, eventType: true, occurredAt: true, locationStatus: true,
            latitude: true, longitude: true,
          },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 mb-1">Meu perfil</h1>
          <p className="text-sm text-gray-500">
            Você pode editar seus dados básicos e sua senha. Papel e status da conta só podem ser
            alterados por um administrador.
          </p>
        </div>
        <TutorialModal />
      </div>

      {canUseTimeClock(me.role) && (
        <TimeClockCard
          passkeyCount={me._count.passkeys}
          todayEntries={todayTimeClockEntries.map((entry) => ({
            ...entry,
            occurredAt: entry.occurredAt.toISOString(),
          }))}
          recentEntries={recentTimeClockEntries.map((entry) => ({
            ...entry,
            occurredAt: entry.occurredAt.toISOString(),
          }))}
        />
      )}

      {canUseTimeClock(me.role) && <PasskeySetupCard count={me._count.passkeys} />}

      <div className="card p-6 space-y-4">
        <div className="text-sm text-gray-600">
          <p>
            <span className="text-gray-400">E-mail:</span> {me.email}
          </p>
          <p>
            <span className="text-gray-400">Papel:</span> {ROLE_LABELS[me.role]}
          </p>
          {me.sellerProfile?.jobTitle && (
            <p>
              <span className="text-gray-400">Cargo:</span> {me.sellerProfile.jobTitle}
            </p>
          )}
        </div>
        <ProfileForm
          initialName={me.name}
          initialPhone={me.sellerProfile?.phone ?? ""}
          initialWhatsapp={me.sellerProfile?.whatsapp ?? ""}
        />
      </div>

      <div className="card p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Alterar senha</h2>
        <ChangePasswordForm sharedPassword={centralEnabled() && me.role!=='REPRESENTANTE' && Boolean(me.centralIdentityLink)} />
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Seus clientes</h2>
          <Link href="/clientes" className="text-sm text-brand hover:underline">
            Ver todos
          </Link>
        </div>

        {myCustomers.length === 0 ? (
          <p className="text-sm text-gray-500">Você ainda não tem clientes na carteira.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {myCustomers.map((c) => (
              <li key={c.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/clientes/${c.id}`}
                    className="font-medium text-gray-900 hover:text-brand truncate block"
                  >
                    {c.tradeName || c.contactName}
                  </Link>
                  <p className="text-xs text-gray-500">
                    Última interação: {c.lastInteractionAt ? formatDate(c.lastInteractionAt) : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <TemperatureBadge temperature={c.temperature} />
                  <StatusBadge status={c.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
