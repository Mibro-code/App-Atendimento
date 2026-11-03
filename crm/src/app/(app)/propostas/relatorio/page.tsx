import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatCentsToBRL } from "@/lib/format";
import { loadProposalActor, proposalWhereForActor } from "@/lib/proposals/proposal-access";
import { proposalsEnabled } from "@/lib/proposals/proposal-config";
import { isFinance, isManager } from "@/lib/proposals/proposal-permissions";

// Indicadores do funil de propostas. O valor da proposta e o do pedido
// correspondente NUNCA são somados como duas vendas: "negociado" e
// "convertido" são colunas distintas. Valores recebidos vêm somente do
// contas a receber do Olist.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const days = (ms: number) => (ms / 86_400_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export default async function ProposalReportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!proposalsEnabled()) return <div className="card p-6 text-sm text-gray-600">Módulo de propostas comerciais desativado.</div>;
  const session = await auth();
  const actor = await loadProposalActor({ id: session!.user.id, role: session!.user.role });
  const params = await searchParams;
  const from = params.de && DATE_RE.test(params.de) ? params.de : null;
  const to = params.ate && DATE_RE.test(params.ate) ? params.ate : null;
  const where: Prisma.CommercialProposalWhereInput = {
    AND: [
      proposalWhereForActor(actor),
      from ? { createdAt: { gte: new Date(`${from}T00:00:00-03:00`) } } : {},
      to ? { createdAt: { lte: new Date(`${to}T23:59:59.999-03:00`) } } : {},
    ],
  };
  const canSeeMoneyReceived = actor.role === "ADMIN" || actor.role === "SUPERVISOR" || isManager(actor) || isFinance(actor);

  const rows = await prisma.commercialProposal.findMany({
    where,
    select: {
      commercialStatus: true, freightCents: true, createdAt: true, submittedAt: true, approvedAt: true, convertedAt: true, validUntil: true,
      orderStatus: true, financialStatus: true, financialPaidCents: true, sellerId: true,
      quote: { select: { totalValueCents: true } },
      seller: { select: { name: true, supervisor: { select: { id: true, name: true } } } },
      dispatches: { where: { succeeded: true }, select: { id: true }, take: 1 },
    },
    take: 5000,
  });
  const now = Date.now();
  const value = (r: (typeof rows)[number]) => (r.quote.totalValueCents ?? 0) + r.freightCents;
  const active = rows.filter((r) => r.commercialStatus !== "CANCELADA");
  const sent = active.filter((r) => r.dispatches.length > 0);
  const approved = active.filter((r) => r.approvedAt);
  const accepted = active.filter((r) => ["ACEITA", "CONVERSAO_SOLICITADA", "CONVERTIDA"].includes(r.commercialStatus));
  const refused = active.filter((r) => r.commercialStatus === "RECUSADA");
  const converted = active.filter((r) => r.commercialStatus === "CONVERTIDA");
  const expired = active.filter((r) => r.validUntil && r.validUntil.getTime() < now && !["CONVERTIDA", "RECUSADA"].includes(r.commercialStatus));
  const pendingPayment = converted.filter((r) => ["SEM_COBRANCA", "AGUARDANDO_PAGAMENTO", "PAGAMENTO_PARCIAL"].includes(r.financialStatus));
  const sum = (list: typeof rows) => list.reduce((t, r) => t + value(r), 0);
  const received = converted.reduce((t, r) => t + (r.financialPaidCents ?? 0), 0);
  const approvalTimes = active.filter((r) => r.submittedAt && r.approvedAt && r.approvedAt >= r.submittedAt).map((r) => r.approvedAt!.getTime() - r.submittedAt!.getTime());
  const conversionTimes = converted.filter((r) => r.convertedAt).map((r) => r.convertedAt!.getTime() - r.createdAt.getTime());
  const avg = (list: number[]) => (list.length ? days(list.reduce((a, b) => a + b, 0) / list.length) : "—");

  const group = (key: (r: (typeof rows)[number]) => string) => {
    const map = new Map<string, { created: number; sent: number; accepted: number; converted: number; negotiated: number; convertedValue: number; received: number }>();
    for (const r of active) {
      const k = key(r);
      const g = map.get(k) ?? { created: 0, sent: 0, accepted: 0, converted: 0, negotiated: 0, convertedValue: 0, received: 0 };
      g.created += 1;
      if (r.dispatches.length) g.sent += 1;
      if (["ACEITA", "CONVERSAO_SOLICITADA", "CONVERTIDA"].includes(r.commercialStatus)) g.accepted += 1;
      g.negotiated += value(r);
      if (r.commercialStatus === "CONVERTIDA") {
        g.converted += 1;
        g.convertedValue += value(r);
        g.received += r.financialPaidCents ?? 0;
      }
      map.set(k, g);
    }
    return [...map.entries()].sort((a, b) => b[1].convertedValue - a[1].convertedValue);
  };
  const bySeller = group((r) => r.seller.name);
  const bySupervisor = group((r) => r.seller.supervisor?.name ?? "Sem supervisor");

  const cards: Array<[string, string]> = [
    ["Propostas criadas", String(active.length)],
    ["Enviadas", String(sent.length)],
    ["Aprovadas internamente", String(approved.length)],
    ["Aceitas", String(accepted.length)],
    ["Recusadas", String(refused.length)],
    ["Expiradas", String(expired.length)],
    ["Convertidas em pedido", String(converted.length)],
    ["Taxa de conversão (enviadas → pedido)", sent.length ? `${Math.round((converted.length / sent.length) * 100)}%` : "—"],
    ["Valor negociado (propostas ativas)", formatCentsToBRL(sum(active))],
    ["Valor convertido em pedidos", formatCentsToBRL(sum(converted))],
    ["Pedidos com pagamento pendente", String(pendingPayment.length)],
    ...(canSeeMoneyReceived ? ([["Recebido confirmado (Olist)", formatCentsToBRL(received)]] as Array<[string, string]>) : []),
    ["Tempo médio até aprovação (dias)", avg(approvalTimes)],
    ["Tempo médio até conversão (dias)", avg(conversionTimes)],
  ];

  const Table = ({ title, data }: { title: string; data: ReturnType<typeof group> }) => (
    <section className="card overflow-x-auto">
      <h2 className="px-4 pt-4 text-sm font-semibold text-gray-700">{title}</h2>
      <table className="mt-2 w-full min-w-[720px] text-sm">
        <thead className="bg-gray-50 text-left text-gray-600">
          <tr>
            <th className="px-3 py-2 font-medium">Nome</th>
            <th className="px-3 py-2 text-right font-medium">Criadas</th>
            <th className="px-3 py-2 text-right font-medium">Enviadas</th>
            <th className="px-3 py-2 text-right font-medium">Aceitas</th>
            <th className="px-3 py-2 text-right font-medium">Convertidas</th>
            <th className="px-3 py-2 text-right font-medium">Negociado</th>
            <th className="px-3 py-2 text-right font-medium">Convertido</th>
            {canSeeMoneyReceived && <th className="px-3 py-2 text-right font-medium">Recebido</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {data.map(([name, g]) => (
            <tr key={name}>
              <td className="px-3 py-2">{name}</td>
              <td className="px-3 py-2 text-right">{g.created}</td>
              <td className="px-3 py-2 text-right">{g.sent}</td>
              <td className="px-3 py-2 text-right">{g.accepted}</td>
              <td className="px-3 py-2 text-right">{g.converted}</td>
              <td className="px-3 py-2 text-right">{formatCentsToBRL(g.negotiated)}</td>
              <td className="px-3 py-2 text-right">{formatCentsToBRL(g.convertedValue)}</td>
              {canSeeMoneyReceived && <td className="px-3 py-2 text-right">{formatCentsToBRL(g.received)}</td>}
            </tr>
          ))}
          {data.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">Sem propostas no período.</td></tr>}
        </tbody>
      </table>
    </section>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-gray-500"><Link href="/propostas" className="underline">Propostas comerciais</Link></p>
          <h1 className="text-xl font-semibold text-gray-900">Indicadores de propostas</h1>
          <p className="text-sm text-gray-500">Dentro do seu escopo de acesso. Os relatórios de vendas existentes continuam seguindo as regras atuais.</p>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2 text-xs">
          <label className="text-gray-600">De<input type="date" name="de" defaultValue={from ?? ""} className="input-field mt-1" /></label>
          <label className="text-gray-600">Até<input type="date" name="ate" defaultValue={to ?? ""} className="input-field mt-1" /></label>
          <button className="btn-primary">Aplicar</button>
        </form>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map(([label, v]) => (
          <div key={label} className="card p-3">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-lg font-semibold text-gray-900">{v}</p>
          </div>
        ))}
      </div>
      <Table title="Por vendedor" data={bySeller} />
      {actor.role !== "VENDEDOR" && actor.role !== "REPRESENTANTE" && <Table title="Por supervisor" data={bySupervisor} />}
      <p className="text-[11px] text-gray-500">
        Valor negociado e valor convertido são medidas separadas da mesma proposta, nunca somadas. Recebido = contas a receber quitadas no Olist (pagamento parcial conta só o valor pago).
        Visualizações da proposta pelo cliente não estão disponíveis na API do Olist.
      </p>
    </div>
  );
}
