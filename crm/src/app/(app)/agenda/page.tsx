import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessCustomer } from "@/lib/authz";
import { AGENDA_VIEWS, APPOINTMENT_TYPES, isDateKey, toDateKey, type AgendaView, type AppointmentTypeValue } from "@/lib/agenda-rules";
import type { AppointmentFormDefaults } from "@/components/agenda/appointment-form";
import { AgendaClient } from "./agenda-client";

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; scope?: string; open?: string; novo?: string; customerId?: string; type?: string }>;
}) {
  const params = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");
  const account = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, role: true, sellerProfile: { select: { displayName: true } } },
  });
  if (!account) redirect("/login");
  const user = { id: account.id, role: account.role };

  const view: AgendaView = AGENDA_VIEWS.includes(params.view as AgendaView) ? (params.view as AgendaView) : "semana";
  const date = isDateKey(params.date) ? params.date : toDateKey(new Date());
  const canViewTeam = account.role === "SUPERVISOR" || account.role === "ADMIN";

  // "+ Agendar" a partir de outra tela: abre o formulário já preenchido. O
  // cliente só é pré-carregado se estiver na carteira visível ao usuário.
  let newDefaults: AppointmentFormDefaults | null = null;
  if (params.novo === "1") {
    newDefaults = {
      dateKey: date,
      type: APPOINTMENT_TYPES.includes(params.type as AppointmentTypeValue) ? (params.type as AppointmentTypeValue) : undefined,
    };
    if (params.customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: params.customerId },
        select: { id: true, sellerId: true, contactName: true, tradeName: true },
      });
      if (customer && (await canAccessCustomer(user, customer.sellerId))) {
        newDefaults.customer = { id: customer.id, name: customer.tradeName || customer.contactName };
        newDefaults.type ??= "FOLLOW_UP";
      }
    }
  }

  return (
    <AgendaClient
      currentUser={{ id: account.id, name: account.sellerProfile?.displayName || account.name, role: account.role }}
      canViewTeam={canViewTeam}
      initialView={view}
      initialDate={date}
      initialScope={canViewTeam && params.scope === "team" ? "team" : "mine"}
      openId={params.open?.slice(0, 64) || null}
      newDefaults={newDefaults}
    />
  );
}
