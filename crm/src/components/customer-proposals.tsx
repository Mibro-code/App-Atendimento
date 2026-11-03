import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/authz";
import { formatCentsToBRL, formatDateBR } from "@/lib/format";
import { CommercialBrandBadge } from "@/components/badges";
import { ProposalFinancialBadge, ProposalOrderBadge, ProposalStatusBadge } from "@/components/proposal-badges";
import { loadProposalActor, proposalWhereForActor } from "@/lib/proposals/proposal-access";
import { isFinance, isManager } from "@/lib/proposals/proposal-permissions";
import { effectiveCommercialStatus } from "@/lib/proposals/proposal-rules";

/**
 * Seção "Propostas comerciais" da ficha do cliente. Mesmo escopo da
 * listagem: o vendedor vê só as próprias propostas deste cliente.
 */
export async function CustomerProposals({ customerId, user }: { customerId: string; user: SessionUser }) {
  const actor = await loadProposalActor(user);
  const proposals = await prisma.commercialProposal.findMany({
    where: { AND: [proposalWhereForActor(actor), { customerId }] },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, brand: true, olistProposalNumber: true, commercialStatus: true, validUntil: true, version: true, createdAt: true,
      freightCents: true, orderStatus: true, olistOrderNumber: true, financialStatus: true, financialPaidCents: true,
      quote: { select: { totalValueCents: true } },
    },
  });
  const now = new Date();
  const value = (p: (typeof proposals)[number]) => (p.quote.totalValueCents ?? 0) + p.freightCents;
  const status = (p: (typeof proposals)[number]) => effectiveCommercialStatus(p, now);
  const open = proposals.filter((p) => ["RASCUNHO", "AGUARDANDO_APROVACAO", "APROVADA_INTERNAMENTE", "REPROVADA_INTERNAMENTE", "EM_NEGOCIACAO"].includes(status(p)));
  const sent = proposals.filter((p) => status(p) === "ENVIADA");
  const approved = proposals.filter((p) => ["APROVADA_INTERNAMENTE", "ENVIADA", "EM_NEGOCIACAO", "ACEITA", "CONVERSAO_SOLICITADA", "CONVERTIDA"].includes(status(p)));
  const refused = proposals.filter((p) => status(p) === "RECUSADA");
  const converted = proposals.filter((p) => status(p) === "CONVERTIDA");
  const negotiated = proposals.filter((p) => p.commercialStatus !== "CANCELADA").reduce((t, p) => t + value(p), 0);
  const convertedValue = converted.reduce((t, p) => t + value(p), 0);
  const canSeeReceived = actor.role === "ADMIN" || actor.role === "SUPERVISOR" || isManager(actor) || isFinance(actor);
  const received = converted.reduce((t, p) => t + (p.financialPaidCents ?? 0), 0);

  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Propostas comerciais ({proposals.length})</h2>
        <Link href={`/cotacoes/nova?cliente=${customerId}`} className="btn-secondary text-xs">Nova proposta (simular)</Link>
      </div>
      <dl className="mb-3 grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
        {[
          ["Em aberto", open.length],
          ["Enviadas", sent.length],
          ["Aprovadas", approved.length],
          ["Recusadas", refused.length],
          ["Convertidas", converted.length],
          ["Pedidos", proposals.filter((p) => p.olistOrderNumber).length],
        ].map(([label, n]) => (
          <div key={label as string} className="rounded-md bg-gray-50 p-2"><dt className="text-gray-500">{label}</dt><dd className="font-semibold text-gray-900">{n}</dd></div>
        ))}
      </dl>
      <p className="mb-3 text-xs text-gray-600">
        Negociado: <strong>{formatCentsToBRL(negotiated)}</strong> · Convertido em pedido: <strong>{formatCentsToBRL(convertedValue)}</strong>
        {canSeeReceived && <> · Recebido (Olist): <strong>{formatCentsToBRL(received)}</strong></>}
      </p>
      <ul className="divide-y divide-gray-100">
        {proposals.map((p) => (
          <li key={p.id} className="py-3">
            <Link href={`/propostas/${p.id}`} className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-1">
                  <CommercialBrandBadge brand={p.brand} />
                  <ProposalStatusBadge status={status(p)} />
                  {p.orderStatus !== "SEM_PEDIDO" && <ProposalOrderBadge status={p.orderStatus} />}
                  {p.olistOrderNumber && <ProposalFinancialBadge status={p.financialStatus} />}
                </div>
                <p className="text-xs text-gray-400">
                  {p.olistProposalNumber ? `Olist nº ${p.olistProposalNumber}` : `CRM ${p.id.slice(-6).toUpperCase()}`} · v{p.version} · {formatDateBR(p.createdAt)}
                  {p.validUntil ? ` · válida até ${formatDateBR(p.validUntil)}` : ""}
                  {p.olistOrderNumber ? ` · pedido nº ${p.olistOrderNumber}` : ""}
                </p>
              </div>
              <p className="text-sm font-medium text-gray-800">{formatCentsToBRL(value(p))}</p>
            </Link>
          </li>
        ))}
        {proposals.length === 0 && <p className="text-sm text-gray-400">Nenhuma proposta comercial para este cliente. Faça uma simulação e transforme-a em proposta.</p>}
      </ul>
    </div>
  );
}
