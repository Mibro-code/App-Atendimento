import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatCentsToBRL, formatCnpjOrCpf, formatDateBR, formatDateTime, formatPhone } from "@/lib/format";
import { CommercialBrandBadge } from "@/components/badges";
import {
  ProposalAcceptanceBadge,
  ProposalApprovalBadge,
  ProposalFinancialBadge,
  ProposalOrderBadge,
  ProposalStatusBadge,
  ProposalSyncBadge,
} from "@/components/proposal-badges";
import { QuotePdfButton } from "@/components/quote-pdf-button";
import { ProposalOrderConsult } from "@/components/proposal-order-consult";
import { QuoteWhatsappButton } from "@/components/quote-whatsapp-button";
import { proposalOriginId, withProposalOrigin } from "@/lib/proposal-origin";
import { centralEnabled } from "@/lib/central-identity";
import { proposalView } from "@/lib/proposals/proposal-core";
import { contentOf } from "@/lib/proposals/proposal-access";
import { isManager } from "@/lib/proposals/proposal-permissions";
import {
  effectiveCommercialStatus,
  formatBps,
  FREIGHT_RESPONSIBILITY,
  LEVEL_LABELS,
  proposalTotals,
  requiredApproverLevel,
} from "@/lib/proposals/proposal-rules";
import { ProposalActions } from "./proposal-actions";

const EVENT_LABELS: Record<string, string> = {
  CREATED: "Proposta criada",
  VERSION_CREATED: "Nova versão",
  INTERNAL_NOTES_UPDATED: "Observações internas atualizadas",
  OLIST_CREATED: "Registrada no Olist",
  OLIST_UPDATED: "Atualizada no Olist",
  OLIST_RECOVERED: "Proposta recuperada no Olist após falha de rede",
  OLIST_DIVERGENCE: "Olist gravou valores diferentes",
  OLIST_SYNC_ERROR: "Erro de sincronização",
  OLIST_EXTERNAL_CHANGE: "Alterada diretamente no Olist",
  OLIST_SITUATION_CHANGED: "Situação alterada no Olist",
  OLIST_CONCLUDED_WITHOUT_ORDER: "Olist indica proposta concluída sem pedido vinculado",
  OLIST_SITUATION_PUSHED: "Situação atualizada no Olist",
  OLIST_SITUATION_ERROR: "Falha ao atualizar a situação no Olist",
  OLIST_MARK_ERROR: "Falha ao marcar no Olist",
  CONFLICT_OVERWRITTEN: "Conflito resolvido: versão do CRM reenviada",
  SUBMITTED_FOR_APPROVAL: "Enviada para aprovação",
  APPROVED: "Aprovada internamente",
  REJECTED: "Reprovada internamente",
  CHANGES_REQUESTED: "Ajustes solicitados",
  SENT: "Enviada ao cliente",
  DISPATCH_FAILED: "Falha no envio",
  ACCEPTED: "Aceite registrado",
  REFUSED: "Recusa registrada",
  CHANGE_REQUESTED_BY_CUSTOMER: "Cliente solicitou alterações",
  REOPENED: "Negociação reaberta",
  CONVERSION_REQUESTED: "Conversão solicitada",
  CONVERSION_DENIED: "Solicitação de conversão recusada",
  CONVERSION_FAILED: "Conversão recusada pelo Olist",
  CONVERSION_UNCERTAIN: "Conversão sem confirmação do Olist",
  CONVERTED: "Convertida em pedido no Olist",
  ORDER_LINKED_MANUALLY: "Pedido vinculado manualmente",
  ORDER_STATUS_CHANGED: "Pedido/financeiro atualizado",
  ORDER_APPROVED_BY_MASTER: "Pedido aprovado pelo Master",
  ORDER_APPROVAL_UNCERTAIN: "Aprovação do pedido sem confirmação",
  FINANCE_REVIEW: "Conferência financeira",
  TRANSFERRED: "Responsável transferido",
  CANCELLED: "Cancelada",
  DUPLICATED: "Duplicada como nova proposta",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-gray-400">{label}</dt>
      <dd className="break-words text-gray-800">{children}</dd>
    </div>
  );
}

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aviso?: string; atendimento?: string }> }) {
  const { id } = await params;
  const notice = (await searchParams).aviso?.slice(0, 300);
  const originConversationId = proposalOriginId((await searchParams).atendimento);
  const session = await auth();
  const user = { id: session!.user.id, role: session!.user.role };
  const view = await proposalView(user, id).catch(() => null);
  if (!view) notFound();
  const { p, decisions, facts, limits, actor, options } = view;
  const attendanceLink = centralEnabled() && actor.role !== "REPRESENTANTE" ? await prisma.centralIdentityLink.findUnique({ where: { userId: actor.id }, select: { enabled: true } }) : null;
  const now = new Date();
  const status = effectiveCommercialStatus(p, now);
  const content = contentOf(p);
  const totals = proposalTotals(content);
  const fiscalDiffCents = p.olistTotalCents !== null ? p.olistTotalCents - totals.totalCents : null;

  const [events, versions, approvals, dispatches, acceptances, supervisor, transferTargets] = await Promise.all([
    prisma.proposalEvent.findMany({ where: { proposalId: p.id }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.proposalVersion.findMany({ where: { proposalId: p.id }, orderBy: { version: "desc" }, select: { version: true, totalCents: true, discountCents: true, reason: true, createdAt: true, createdById: true } }),
    prisma.proposalApproval.findMany({ where: { proposalId: p.id }, orderBy: { createdAt: "desc" } }),
    prisma.proposalDispatch.findMany({ where: { proposalId: p.id }, orderBy: { createdAt: "desc" } }),
    prisma.proposalAcceptance.findMany({ where: { proposalId: p.id }, orderBy: { createdAt: "desc" } }),
    p.seller.supervisorId ? prisma.user.findUnique({ where: { id: p.seller.supervisorId }, select: { name: true } }) : null,
    decisions.transfer.allowed
      ? prisma.user.findMany({
          where: {
            active: true, deletedAt: null, id: { not: p.sellerId }, role: { in: ["VENDEDOR", "REPRESENTANTE", "SUPERVISOR"] },
            olistSellerLinks: { some: { brand: p.brand, active: true } },
            ...(actor.role === "ADMIN" || isManager(actor) ? {} : { id: { in: actor.teamSellerIds as string[], not: p.sellerId } }),
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [],
  ]);
  const actorIds = [...new Set([...events.map((e) => e.actorId), ...versions.map((v) => v.createdById), ...approvals.map((a) => a.actorId), ...dispatches.map((d) => d.actorId), ...acceptances.map((a) => a.actorId)].filter(Boolean) as string[])];
  const names = new Map((actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
  const who = (id: string | null) => (id ? names.get(id) ?? "usuário" : "Olist/sistema");
  const approverLevel = requiredApproverLevel(facts.discountBps, limits);
  const brandBtn = p.brand === "MIBRO" ? "btn-brand-mibro" : "btn-brand-sincrofit";

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs text-gray-500"><Link href="/propostas" className="underline">Propostas comerciais</Link></p>
          <h1 className="text-xl font-semibold text-gray-900">
            Proposta {p.olistProposalNumber ? `nº ${p.olistProposalNumber}` : `CRM ${p.id.slice(-6).toUpperCase()}`}
            <span className="ml-2 text-sm font-normal text-gray-500">versão {p.version}</span>
          </h1>
          <div className="flex flex-wrap gap-1">
            <CommercialBrandBadge brand={p.brand} />
            <ProposalStatusBadge status={status} />
            <ProposalApprovalBadge status={p.approvalStatus} />
            <ProposalAcceptanceBadge status={p.acceptanceStatus} />
            <ProposalSyncBadge status={p.syncStatus} />
            {p.orderStatus !== "SEM_PEDIDO" && <ProposalOrderBadge status={p.orderStatus} />}
            {p.olistOrderId && <ProposalFinancialBadge status={p.financialStatus} />}
          </div>
          <p className="text-xs text-gray-500">
            Criada em {formatDateTime(p.createdAt)} · atualizada em {formatDateTime(p.updatedAt)} · {p.validUntil ? `válida até ${formatDateBR(p.validUntil)}` : "sem validade definida"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <QuotePdfButton quoteId={p.quoteId} />
          {decisions.edit.allowed && <Link href={withProposalOrigin(`/propostas/${p.id}/editar`, originConversationId)} className={brandBtn}>Editar</Link>}
        </div>
      </div>

      {notice && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Versão salva no CRM, mas a sincronização com o Olist falhou: {notice}</div>}
      {p.syncStatus === "CONFLITO" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {p.lastSyncError ?? "A proposta no Olist diverge da versão do CRM."} Envio, aceite e conversão ficam bloqueados até a supervisão decidir.
        </div>
      )}
      {p.orderStatus === "CONVERSAO_INCERTA" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Não foi possível confirmar se o Olist gerou o pedido. Confira no Olist pela proposta {p.olistProposalNumber ?? ""} e vincule o pedido gerado. A conversão não é repetida automaticamente.
        </div>
      )}
      {facts.olistConcluded && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          O Olist indica esta proposta como concluída, mas nenhum pedido está vinculado no CRM. Se a venda foi gerada no Olist, vincule o pedido.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-5"><h2 className="mb-3 text-sm font-semibold">Etapas do atendimento comercial</h2><ol className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">{[
            ["Proposta registrada", !!p.olistProposalId], ["Aceite do cliente", p.acceptanceStatus === "ACEITA"], ["Pedido criado", !!p.olistOrderId], ["Pedido aprovado", ["PEDIDO_APROVADO", "FATURADO", "ENVIADO", "ENTREGUE"].includes(p.orderStatus)], ["Pagamento confirmado", p.financialStatus === "PAGAMENTO_CONFIRMADO"], ["Entrega concluída", p.orderStatus === "ENTREGUE"],
          ].map(([label, done]) => <li key={String(label)} className={`rounded-lg border p-3 ${done ? "border-emerald-500/40 text-emerald-600" : "border-gray-200 text-gray-500"}`}>{done ? "✓ " : "○ "}{label}</li>)}</ol></section>
          <ProposalOrderConsult id={p.id} hasOrder={!!p.olistOrderId} financial={decisions.view_financial_values.allowed}/>
          {attendanceLink?.enabled && decisions.register_dispatch.allowed && <QuoteWhatsappButton quoteId={p.quoteId} originConversationId={originConversationId}/>}
          {attendanceLink?.enabled && decisions.prepare_order_update.allowed && <QuoteWhatsappButton quoteId={p.quoteId} originConversationId={originConversationId} includeOrderUpdates/>}
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Cliente</h2>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Field label="Nome / razão social"><Link href={`/clientes/${p.customer.id}`} className="underline">{p.customer.legalName || p.customer.tradeName || p.customer.contactName}</Link></Field>
              <Field label="CPF/CNPJ">{formatCnpjOrCpf(p.customer.cnpjDigits || p.customer.cpfDigits)}</Field>
              <Field label="Contato">{p.customer.contactName}</Field>
              <Field label="E-mail">{p.customer.email || "—"}</Field>
              <Field label="Telefone">{p.customer.phoneDigits ? formatPhone(p.customer.phoneDigits) : "—"}</Field>
              <Field label="Endereço">{[p.customer.addressStreet, p.customer.addressNumber, p.customer.addressComplement, p.customer.addressDistrict, p.customer.city, p.customer.state].filter(Boolean).join(", ") || "—"}</Field>
            </dl>
            <p className="mt-2 text-[11px] text-gray-500">Entrega no endereço cadastrado. Inscrição estadual não é mantida no CRM (o Olist usa o cadastro do contato).</p>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Itens</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">Produto</th>
                    <th className="px-3 py-2 font-medium">SKU</th>
                    <th className="px-3 py-2 font-medium text-right">Qtd.</th>
                    <th className="px-3 py-2 font-medium text-right">Preço unit.</th>
                    <th className="px-3 py-2 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {p.quote.items.map((i) => (
                    <tr key={i.id}>
                      <td className="px-3 py-2">{i.productName}{i.colorName ? ` — ${i.colorName}` : ""}{i.manualTier && <span className="badge ml-1 bg-amber-100 text-amber-800">faixa manual</span>}</td>
                      <td className="px-3 py-2 text-gray-500">{i.sku}</td>
                      <td className="px-3 py-2 text-right">{i.quantity}</td>
                      <td className="px-3 py-2 text-right">{formatCentsToBRL(i.unitPriceCents)}</td>
                      <td className="px-3 py-2 text-right">{formatCentsToBRL(i.quantity * i.unitPriceCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Field label="Subtotal">{formatCentsToBRL(totals.subtotalCents)}</Field>
              <Field label="Desconto">{content.discountCents ? `${formatCentsToBRL(content.discountCents)} (${formatBps(facts.discountBps)})` : "—"}</Field>
              <Field label="Frete">{content.freightCents ? formatCentsToBRL(content.freightCents) : "—"}</Field>
              <Field label="Total comercial"><strong>{formatCentsToBRL(totals.totalCents)}</strong></Field>
            </dl>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Condições comerciais e fiscal</h2>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Field label="Condição de pagamento">{p.paymentType === "Parcelas" ? p.paymentCondition : p.paymentType === "Texto livre" ? p.paymentText : "Não informada"}</Field>
              <Field label="Frete por conta">{p.freightResponsibility ? FREIGHT_RESPONSIBILITY[p.freightResponsibility] ?? p.freightResponsibility : "—"}</Field>
              <Field label="Prazo de entrega">{p.deliveryTerm || "—"}</Field>
              <Field label="Validade">{p.validityDays ? `${p.validityDays} dias${p.validUntil ? ` (até ${formatDateBR(p.validUntil)})` : ""}` : "—"}</Field>
              <Field label="Observações ao cliente">{p.customerNotes || "—"}</Field>
              {decisions.edit.allowed || actor.role !== "VENDEDOR" ? <Field label="Observações internas">{p.internalNotes || "—"}</Field> : null}
              {p.discountJustification && <Field label="Justificativa do desconto">{p.discountJustification}</Field>}
              <Field label="Alçada necessária">{facts.discountBps > 0 ? `Desconto ${formatBps(facts.discountBps)} — aprovação do ${LEVEL_LABELS[approverLevel]}` : `Sem desconto — aprovação do ${LEVEL_LABELS[approverLevel]}`}</Field>
              <Field label="Total no Olist (com impostos)">{p.olistTotalCents !== null ? formatCentsToBRL(p.olistTotalCents) : "Aguardando sincronização"}</Field>
              <Field label="Impostos/ajustes calculados pelo Olist">{fiscalDiffCents !== null ? formatCentsToBRL(fiscalDiffCents) : "—"}</Field>
            </dl>
            <p className="mt-2 text-[11px] text-gray-500">O Olist não detalha impostos por proposta na API; a diferença entre o total do Olist e o total comercial é exibida como informada. Natureza de operação conforme configuração da integração.</p>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Histórico</h2>
            <ul className="space-y-2 text-xs text-gray-600">
              {events.map((e) => (
                <li key={e.id}>
                  <span className="font-medium text-gray-800">{EVENT_LABELS[e.type] ?? e.type}</span>
                  {e.version ? ` · v${e.version}` : ""} · {who(e.actorId)}{e.origin !== "CRM" ? ` (${e.origin === "OLIST" ? "origem Olist" : "sistema"})` : ""} — {formatDateTime(e.createdAt)}
                  {(() => {
                    const d = (e.data ?? {}) as Record<string, unknown>;
                    const detail = [d.reason, d.justification, d.note, Array.isArray(d.changedFields) && d.changedFields.length ? `campos: ${(d.changedFields as string[]).join(", ")}` : null, Array.isArray(d.fields) && d.fields.length ? `campos: ${(d.fields as string[]).join(", ")}` : null, Array.isArray(d.problems) && d.problems.length ? `divergências: ${(d.problems as string[]).join(" ")}` : null, d.recipient ? `para ${d.recipient}` : null, d.description, d.code ? `código ${d.code}` : null].filter(Boolean);
                    return detail.length ? <span className="block text-gray-400">{detail.join(" · ")}</span> : null;
                  })()}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="space-y-6">
          <ProposalActions
            proposalId={p.id}
            brand={p.brand}
            version={p.version}
            customerEmail={p.customer.email}
            decisions={decisions}
            conversionMode={options.conversionMode}
            olistNumber={p.olistProposalNumber}
            transferTargets={transferTargets}
          />

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Responsáveis</h2>
            <dl className="space-y-2 text-sm">
              <Field label="Vendedor">{p.seller.sellerProfile?.displayName ?? p.seller.name}</Field>
              <Field label="Vendedor no Olist">{p.olistSellerId ? `id ${p.olistSellerId}` : "sem vínculo"}{!facts.sellerLinked && <span className="block text-xs text-red-600">Vínculo Olist ausente ou alterado.</span>}</Field>
              <Field label="Supervisor">{supervisor?.name ?? "—"}</Field>
              <Field label="Aprovação">{approvals[0] ? `${approvals[0].decision === "APROVADA" ? "Aprovada" : approvals[0].decision === "REPROVADA" ? "Reprovada" : "Ajustes"} por ${who(approvals[0].actorId)} (v${approvals[0].version})${approvals[0].invalidatedAt ? " — invalidada" : ""}` : "—"}</Field>
            </dl>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Olist</h2>
            <dl className="space-y-2 text-sm">
              <Field label="Proposta no Olist">{p.olistProposalId ? `nº ${p.olistProposalNumber ?? "—"} (id ${p.olistProposalId})` : "Ainda não registrada"}</Field>
              <Field label="Situação no Olist">{p.olistSituation ?? "—"}</Field>
              <Field label="Versão sincronizada">{p.syncedVersion ? `v${p.syncedVersion}${p.syncedVersion !== p.version ? " (desatualizada)" : ""}` : "—"}</Field>
              <Field label="Última consulta">{p.lastSyncedAt ? formatDateTime(p.lastSyncedAt) : "—"}</Field>
              {p.lastSyncError && <Field label="Último erro"><span className="text-red-700">{p.lastSyncError}</span></Field>}
            </dl>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Pedido e financeiro</h2>
            {p.olistOrderId ? (
              <dl className="space-y-2 text-sm">
                <Field label="Pedido de venda">nº {p.olistOrderNumber ?? "—"} (id {p.olistOrderId})</Field>
                <Field label="Situação do pedido">{p.olistOrderSituation ?? "—"}</Field>
                <Field label="Recebimento"><ProposalFinancialBadge status={p.financialStatus} /></Field>
                {decisions.view_financial_values.allowed && (
                  <>
                    <Field label="Valor das contas">{p.financialDueCents !== null ? formatCentsToBRL(p.financialDueCents) : "—"}</Field>
                    <Field label="Recebido">{p.financialPaidCents !== null ? formatCentsToBRL(p.financialPaidCents) : "—"}</Field>
                    <Field label="Em aberto">{p.financialOpenCents !== null ? formatCentsToBRL(p.financialOpenCents) : "—"}</Field>
                  </>
                )}
                <Field label="Convertida em">{p.convertedAt ? `${formatDateTime(p.convertedAt)} por ${who(p.convertedById)}` : "—"}</Field>
                <Field label="Última consulta">{p.orderLastSyncedAt ? formatDateTime(p.orderLastSyncedAt) : "—"}</Field>
              </dl>
            ) : (
              <p className="text-sm text-gray-500">Nenhum pedido vinculado.</p>
            )}
            <p className="mt-2 text-[11px] text-gray-500">Aprovação do pedido não é pagamento: o recebimento vem das contas a receber do Olist.</p>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Versões, envios e aceites</h2>
            <ul className="space-y-1 text-xs text-gray-600">
              {versions.map((v) => (
                <li key={v.version}>v{v.version} · {formatCentsToBRL(v.totalCents)} · {who(v.createdById)} · {formatDateTime(v.createdAt)}{v.reason ? ` — ${v.reason}` : ""}</li>
              ))}
            </ul>
            <h3 className="mt-3 text-xs font-semibold text-gray-700">Envios</h3>
            <ul className="space-y-1 text-xs text-gray-600">
              {dispatches.length === 0 && <li>Nenhum envio registrado.</li>}
              {dispatches.map((d) => (
                <li key={d.id} className={d.succeeded ? "" : "text-red-700"}>
                  v{d.version} · {d.channel === "EMAIL" ? `e-mail para ${d.recipient}` : d.description} · {who(d.actorId)} · {formatDateTime(d.createdAt)}{d.succeeded ? "" : ` — falhou: ${d.errorMessage}`}
                </li>
              ))}
            </ul>
            <h3 className="mt-3 text-xs font-semibold text-gray-700">Respostas do cliente</h3>
            <ul className="space-y-1 text-xs text-gray-600">
              {acceptances.length === 0 && <li>Nenhuma resposta registrada.</li>}
              {acceptances.map((a) => (
                <li key={a.id}>
                  v{a.version} · {a.decision === "ACEITA" ? "Aceite" : a.decision === "RECUSADA" ? "Recusa" : "Alteração solicitada"} via {a.channel.toLowerCase()} em {formatDateTime(a.occurredAt)}
                  {a.contactName ? ` (${a.contactName})` : ""} · registrado por {who(a.actorId)} — registro manual
                  <span className="block text-gray-400">Evidência: {a.evidence}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
