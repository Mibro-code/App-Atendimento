import { prisma } from "@/lib/prisma";
import { getCustomerScopeFilter, type SessionUser } from "@/lib/authz";
import { startOfToday, endOfToday } from "@/lib/followups";
import { formatCentsToBRL } from "@/lib/format";
import { syncAutomaticFollowUpsForScope } from "@/lib/automatic-followups";
import Link from "next/link";
import { myAppointmentsFilter } from "@/lib/agenda";
import { addDaysToKey, isOverdue, relativeDayLabel, timeRangeLabel, toDateKey, typeLabel, zonedDate } from "@/lib/agenda-rules";

export async function EmployeeDashboard({ user }: { user: SessionUser }) {
  const scope = await getCustomerScopeFilter(user);
  const { staleCount } = await syncAutomaticFollowUpsForScope(user);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const [totalCustomers, activeCustomers, hotCustomers, followUpsToday, openQuotes, simulationsSent, realQuotes, confirmedSales, monthSales, customersWithQuote] = await Promise.all([
    prisma.customer.count({ where: scope }), prisma.customer.count({ where: { ...scope, status: "CLIENTE_ATIVO" } }),
    prisma.customer.count({ where: { ...scope, temperature: "QUENTE" } }),
    prisma.followUp.count({ where: { status: "PENDENTE", dueAt: { gte: startOfToday(), lte: endOfToday() }, customer: { ...scope, pipelineStage: "FOLLOW_UP", lastSaleAt: { not: null } } } }),
    prisma.quote.count({ where: { deletedAt: null, status: "ABERTA", customer: scope } }),
    prisma.quote.count({ where: { deletedAt: null, mode: "SIMULATION", sentAt: { not: null }, customer: scope } }),
    prisma.quote.count({ where: { deletedAt: null, mode: "REAL", customer: scope } }),
    prisma.sale.count({ where: { stage: "PAGAMENTO_CONFIRMADO", customer: scope } }),
    prisma.sale.aggregate({ where: { confirmedAt: { gte: monthStart }, customer: scope }, _sum: { valueCents: true } }),
    prisma.customer.count({ where: { ...scope, quotes: { some: { deletedAt: null } } } }),
  ]);
  // Próximos compromissos da Agenda (só os do próprio usuário, a partir de hoje).
  const upcomingAppointments = await prisma.appointment.findMany({
    where: { ...myAppointmentsFilter(user.id), status: "PENDENTE", startsAt: { gte: zonedDate(toDateKey(new Date())) } },
    select: { id: true, title: true, type: true, startsAt: true, endsAt: true, allDay: true, customer: { select: { contactName: true, tradeName: true } } },
    orderBy: { startsAt: "asc" },
    take: 4,
  });
  const conversionRate = customersWithQuote ? Math.round((confirmedSales / customersWithQuote) * 100) : 0;
  const cards = [
    ["Clientes cadastrados", totalCustomers], ["Clientes ativos", activeCustomers], ["Clientes quentes", hotCustomers],
    ["Sem interação/venda", staleCount], ["Follow-ups de recompra hoje", followUpsToday], ["Propostas em rascunho", openQuotes],
    ["Simulações enviadas", simulationsSent], ["Cotações reais", realQuotes], ["Vendas confirmadas", confirmedSales],
    ["Valor vendido no mês", formatCentsToBRL(monthSales._sum.valueCents ?? 0)], ["Taxa de conversão", `${conversionRate}%`],
  ];
  return <div><h1 className="mb-1 text-xl font-semibold text-gray-900">Painel</h1><p className="mb-6 text-sm text-gray-500">Visão geral da sua carteira.</p><div className="grid grid-cols-2 gap-4 md:grid-cols-3">{cards.map(([label,value]) => <div key={String(label)} className="card p-4"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p></div>)}</div><UpcomingAppointments items={upcomingAppointments} /></div>;
}

function UpcomingAppointments({ items }: {
  items: Array<{ id: string; title: string; type: string; startsAt: Date; endsAt: Date | null; allDay: boolean; customer: { contactName: string; tradeName: string | null } | null }>;
}) {
  const todayKey = toDateKey(new Date());
  return (
    <section className="card mt-6 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Próximos compromissos</h2>
        <Link href="/agenda?view=lista" className="text-xs text-gray-500 hover:underline">Ver agenda</Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhum compromisso agendado. <Link href="/agenda?novo=1" className="underline">Agendar</Link></p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((item) => {
            const dayKey = toDateKey(item.startsAt);
            return (
              <li key={item.id}>
                <Link href={`/agenda?view=hoje&date=${dayKey}&open=${item.id}`} className="flex items-baseline gap-3 py-2 hover:bg-gray-50">
                  <span className={`w-28 shrink-0 text-xs tabular-nums ${dayKey === todayKey ? "font-semibold text-gray-900" : dayKey === addDaysToKey(todayKey, 1) ? "text-gray-700" : "text-gray-500"}`}>
                    {relativeDayLabel(dayKey)} — {timeRangeLabel(item).split("–")[0]}
                  </span>
                  <span className="min-w-0 truncate text-sm text-gray-800">
                    {item.title}
                    <span className="text-gray-400"> · {[typeLabel(item.type), item.customer ? item.customer.tradeName || item.customer.contactName : null].filter(Boolean).join(" · ")}</span>
                    {isOverdue({ ...item, status: "PENDENTE" }) && <span className="ml-2 text-xs font-medium text-amber-700">⚠ Atrasado</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
