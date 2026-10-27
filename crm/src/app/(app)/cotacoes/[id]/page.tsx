import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessCustomer } from "@/lib/authz";
import { formatCentsToBRL, formatDateTime, formatCnpjOrCpf } from "@/lib/format";
import { CommercialBrandBadge, QuoteStatusBadge, ProposalModeBadge } from "@/components/badges";
import { ResumeProposalButton } from "@/app/(app)/clientes/[id]/quote-session-button";
import { isLowAccuracy } from "@/lib/location";
import { QuoteTrashButton } from "../quote-trash-button";
import { canRestoreSimulation, quoteRestoreDeadline } from "@/lib/quote-trash-rules";
import { isEditableNativeQuote } from "@/lib/quotes/native-quote-rules";
import { customerOrderReadiness } from "@/lib/olist/real-order-rules";
import { RealOrderPanel } from "./real-order-panel";
import {QuoteWhatsappButton} from '@/components/quote-whatsapp-button';
import {centralEnabled} from '@/lib/central-identity';

interface ProductSummaryItem {
  sku?: string;
  name?: string;
  variant?: string;
  quantity?: number;
  unitPriceCents?: number;
  subtotalCents?: number;
  priceTier?: string;
  manualTier?: boolean;
}

const TIER_SHORT: Record<string, string> = { TIER1: "Tabela 1", TIER2: "Tabela 2", TIER3: "Tabela 3" };

const QUOTE_ACTION_LABELS: Record<string, string> = {
  QUOTE_CREATED: "Cotação criada no CRM",
  QUOTE_CALCULATED: "Simulação concluída",
  QUOTE_SYNCED_FROM_SHOPIFY: "Sincronizada do Shopify",
  QUOTE_SESSION_CREATED: "Calculadora Shopify aberta",
  PROPOSAL_SENT: "Proposta enviada",
  PROPOSAL_CONVERTED: "Convertida em cotação real",
  PROPOSAL_LOCATION_CAPTURED: "Localização registrada",
  PRICE_MISMATCH_DETECTED: "Divergência de preço do navegador ignorada",
  QUOTE_REPRICED: "Preços recalculados (cliente recorrente no Olist)",
  OLIST_ORDER_CALCULATED: "Pedido calculado e conferido no Olist",
  OLIST_ORDER_SENT_FOR_REVIEW: "Pedido enviado para aprovação",
  OLIST_SYNC_FAILED: "Falha na sincronização com o Olist",
};

/** Resumo legível das condições gravadas no evento (faixa, total, desconto). */
function auditDetail(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const parts: string[] = [];
  if (m.priceGroup) parts.push(m.priceGroup === "REPRESENTATIVE" ? "tabela de representantes" : "tabela de vendedores");
  if (typeof m.priceTableVersion === "number") parts.push(`v${m.priceTableVersion}`);
  if (typeof m.selectedTier === "string") parts.push(`${TIER_SHORT[m.selectedTier] ?? m.selectedTier} manual`);
  else if (typeof m.orderAutomaticTier === "string") parts.push(`${TIER_SHORT[m.orderAutomaticTier]} automática`);
  if (typeof m.discountCents === "number" && m.discountCents > 0) parts.push(`desconto ${formatCentsToBRL(m.discountCents)}`);
  if (typeof m.totalCents === "number") parts.push(`total ${formatCentsToBRL(m.totalCents)}`);
  return parts.length ? parts.join(" · ") : null;
}

export default async function ProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const user = { id: session!.user.id, role: session!.user.role };

  const quote = await prisma.quote.findUnique({
    where: { id },
    include: {
      customer: {
        select: {
          id: true, contactName: true, tradeName: true, legalName: true, cnpjDigits: true, cpfDigits: true, sellerId: true,
          email: true, phoneDigits: true, addressStreet: true, addressNumber: true, addressDistrict: true, addressComplement: true,
          city: true, state: true, zipDigits: true,
        },
      },
      olistSyncAttempts: { orderBy: { startedAt: "desc" }, take: 20 },
      seller: { select: { id: true, name: true, sellerProfile: { select: { displayName: true } } } },
      olistOrder: true,
      sourceQuote: { select: { id: true, mode: true, createdAt: true, totalValueCents: true, deletedAt: true } },
      convertedQuotes: { select: { id: true, mode: true, createdAt: true, totalValueCents: true, status: true } },
      // Só a captura do ENVIO (PROPOSAL_SENT) fica vinculada à Quote real —
      // PROPOSAL_STARTED acontece antes da Quote existir (ver
      // api/customers/[id]/quote-session/route.ts), não aparece aqui.
      locationCaptures: { where: { locationSource: "PROPOSAL_SENT" }, take: 1 },
      items: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!quote) notFound();
  if (quote.deletedAt && user.role !== "ADMIN") notFound();
  if (!(await canAccessCustomer(user, quote.customer.sellerId))) redirect("/cotacoes");

  const summary = (quote.productsSummary ?? {}) as { products?: ProductSummaryItem[]; totalQuantity?: number; shop?: string | null };
  const products = summary.products ?? [];
  const canConvert = !quote.deletedAt && quote.mode === "SIMULATION" && quote.status !== "CONVERTIDA" && quote.status !== "CANCELADA";
  const canReopen = !quote.deletedAt && quote.status !== "CANCELADA" && quote.status !== "CONVERTIDA";
  const canEditNative = isEditableNativeQuote(quote);
  const link=centralEnabled()&&user.role!=='REPRESENTANTE'?await prisma.centralIdentityLink.findUnique({where:{userId:user.id},select:{enabled:true}}):null;

  const auditEvents = await prisma.auditLog.findMany({
    where: { entityType: "Quote", entityId: quote.id },
    orderBy: { createdAt: "desc" },
    include: { actor: { select: { name: true } } },
  });

  const location = quote.locationCaptures[0] ?? null;
  const realQuote = quote.convertedQuotes.find((q) => q.mode === "REAL" && q.status !== "CANCELADA") ?? null;
  const lastGoodCalc = quote.olistSyncAttempts.find((a) => a.action === "CALCULATE" && a.status === "SUCCEEDED");
  const olistConfirmedTotalCents =
    ((lastGoodCalc?.response as { values?: { total_confirmed_by_olist?: number } } | null)?.values?.total_confirmed_by_olist) ?? null;

  return (
    <div className="max-w-4xl space-y-6">
      {link?.enabled&&!quote.deletedAt?<QuoteWhatsappButton quoteId={quote.id}/>:null}
      {quote.deletedAt && <div className="card border border-amber-300 p-4 space-y-2">
        <p>Simulação excluída em {formatDateTime(quote.deletedAt)}. Histórico preservado.</p>
        <p className="text-sm">Prazo para restauração: {formatDateTime(quoteRestoreDeadline(quote.deletedAt))}.</p>
        {canRestoreSimulation(user.role, quote.deletedAt) ? <QuoteTrashButton id={quote.id} restore /> : <p className="text-sm">Prazo encerrado. Valores e produtos continuam disponíveis para consulta.</p>}
      </div>}
      {!quote.deletedAt && quote.mode === "SIMULATION" && (user.role === "ADMIN" || user.role === "SUPERVISOR") && <QuoteTrashButton id={quote.id} />}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-semibold text-gray-900">
              Proposta #{quote.id.slice(-6).toUpperCase()}
            </h1>
            <CommercialBrandBadge brand={quote.brand} />
            <ProposalModeBadge mode={quote.mode} />
            <QuoteStatusBadge status={quote.status} />
          </div>
          <p className="text-sm text-gray-500">
            <Link href={`/clientes/${quote.customer.id}`} className="underline">
              {quote.customer.tradeName || quote.customer.contactName}
            </Link>{" "}
            · {formatCnpjOrCpf(quote.customer.cnpjDigits || quote.customer.cpfDigits)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Itens da proposta</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Produto</th>
                    <th className="px-3 py-2 font-medium">SKU</th>
                    <th className="px-3 py-2 font-medium">Variação</th>
                    <th className="px-3 py-2 font-medium text-right">Qtd.</th>
                    <th className="px-3 py-2 font-medium">Faixa</th>
                    <th className="px-3 py-2 font-medium text-right">Preço unit.</th>
                    <th className="px-3 py-2 font-medium text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {products.map((p, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2">{p.name || "-"}</td>
                      <td className="px-3 py-2 text-gray-500">{p.sku || "-"}</td>
                      <td className="px-3 py-2 text-gray-500">{p.variant || "-"}</td>
                      <td className="px-3 py-2 text-right">{p.quantity ?? "-"}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{p.priceTier ? TIER_SHORT[p.priceTier] ?? p.priceTier : "-"}{p.manualTier && <span className="ml-1 text-amber-700">(manual)</span>}</td>
                      <td className="px-3 py-2 text-right">{formatCentsToBRL(p.unitPriceCents)}</td>
                      <td className="px-3 py-2 text-right">{formatCentsToBRL(p.subtotalCents)}</td>
                    </tr>
                  ))}
                  {products.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                        Nenhum item registrado ainda para esta proposta.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {quote.origin === "CRM" && quote.items.length > 0 && (
            <div className="card p-5">
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Condições comerciais aplicadas</h2>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-gray-400">Grupo comercial</dt>
                  <dd className="text-gray-800">{quote.priceGroup === "REPRESENTATIVE" ? "Representantes" : "Vendedores"}</dd>
                </div>
                <div>
                  <dt className="text-gray-400">Tabela de preços</dt>
                  <dd className="text-gray-800">versão {quote.items[0].priceTableVersion}</dd>
                </div>
                <div>
                  <dt className="text-gray-400">Faixa automática</dt>
                  <dd className="text-gray-800">{[...new Set(quote.items.map((i) => TIER_SHORT[i.automaticTier]))].join(" / ")}</dd>
                </div>
                <div>
                  <dt className="text-gray-400">Faixa aplicada</dt>
                  <dd className="text-gray-800">
                    {[...new Set(quote.items.map((i) => TIER_SHORT[i.appliedTier]))].join(" / ")}
                    {quote.items.some((i) => i.manualTier) && <span className="badge ml-1 bg-amber-100 text-amber-800">manual</span>}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-gray-500">
                Preços congelados no momento do cálculo: mudanças posteriores na tabela não alteram esta proposta.
              </p>
            </div>
          )}

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Totais</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-gray-400">Total</dt>
                <dd className="text-gray-800 font-medium">{formatCentsToBRL(quote.totalValueCents)}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Desconto</dt>
                <dd className="text-gray-800">{quote.discountCents ? formatCentsToBRL(quote.discountCents) : "-"}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Cupom</dt>
                <dd className="text-gray-800">{quote.couponCode || "-"}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Quantidade total</dt>
                <dd className="text-gray-800">{summary.totalQuantity ?? "-"}</dd>
              </div>
            </dl>
            {quote.notes && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <dt className="text-gray-400 text-sm">Observação</dt>
                <dd className="text-gray-700 text-sm">{quote.notes}</dd>
              </div>
            )}
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Timeline</h2>
            <ul className="space-y-2 text-xs text-gray-500">
              <li>
                <span className="font-medium text-gray-700">Criada em</span> {formatDateTime(quote.createdAt)}
              </li>
              {quote.sentAt && (
                <li>
                  <span className="font-medium text-gray-700">Enviada por e-mail em</span>{" "}
                  {formatDateTime(quote.sentAt)}
                  {quote.sentToEmail ? ` para ${quote.sentToEmail}` : ""}
                </li>
              )}
              {quote.convertedAt && (
                <li>
                  <span className="font-medium text-gray-700">Convertida em cotação real em</span>{" "}
                  {formatDateTime(quote.convertedAt)}
                </li>
              )}
              {auditEvents.map((e) => (
                <li key={e.id}>
                  <span className="font-medium text-gray-700">{QUOTE_ACTION_LABELS[e.action] ?? e.action}</span>
                  {e.actor ? ` por ${e.actor.name}` : " (integração)"} — {formatDateTime(e.createdAt)}
                  {auditDetail(e.metadata) && <span className="block text-gray-400">{auditDetail(e.metadata)}</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Detalhes</h2>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-gray-400">Empresa</dt>
                <dd><CommercialBrandBadge brand={quote.brand} /></dd>
              </div>
              <div>
                <dt className="text-gray-400">Vendedor</dt>
                <dd className="text-gray-800">{quote.seller.sellerProfile?.displayName ?? quote.seller.name}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Origem</dt>
                <dd className="text-gray-800">{summary.shop || "-"}</dd>
              </div>
              {quote.olistOrder && (
                <div>
                  <dt className="text-gray-400">Pedido Olist</dt>
                  <dd className="text-gray-800">
                    {quote.olistOrder.orderNumber || quote.olistOrder.olistOrderId} ({quote.olistOrder.crmStatus})
                  </dd>
                </div>
              )}
              {quote.sourceQuote && (!quote.sourceQuote.deletedAt || user.role === "ADMIN") && (
                <div>
                  <dt className="text-gray-400">Convertida a partir de</dt>
                  <dd className="text-gray-800">
                    <Link href={`/cotacoes/${quote.sourceQuote.id}`} className="underline">
                      Simulação de {formatDateTime(quote.sourceQuote.createdAt)}
                    </Link>
                  </dd>
                </div>
              )}
              {quote.convertedQuotes.length > 0 && (
                <div>
                  <dt className="text-gray-400">Cotações reais geradas</dt>
                  <dd className="text-gray-800 space-y-1">
                    {quote.convertedQuotes.map((c) => (
                      <div key={c.id}>
                        <Link href={`/cotacoes/${c.id}`} className="underline">
                          {formatCentsToBRL(c.totalValueCents)} — {formatDateTime(c.createdAt)}
                        </Link>
                      </div>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Local da proposta</h2>
            {!location && (
              <p className="text-sm text-gray-400">Nenhuma tentativa de localização registrada para esta proposta.</p>
            )}
            {location && location.locationStatus === "GRANTED" && (
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-gray-400">Localização registrada</dt>
                  <dd className="text-gray-800">{location.capturedAt ? formatDateTime(location.capturedAt) : "-"}</dd>
                </div>
                <div>
                  <dt className="text-gray-400">Precisão aproximada</dt>
                  <dd className={isLowAccuracy(location.accuracyMeters) ? "text-amber-600" : "text-gray-800"}>
                    {location.accuracyMeters != null ? `${Math.round(location.accuracyMeters)} m` : "-"}
                    {isLowAccuracy(location.accuracyMeters) && (
                      <span className="block text-xs">Localização de baixa precisão</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-400">Vendedor</dt>
                  <dd className="text-gray-800">{quote.seller.sellerProfile?.displayName ?? quote.seller.name}</dd>
                </div>
                {location.latitude != null && location.longitude != null && (
                  <a
                    className="btn-secondary inline-block text-xs mt-1"
                    href={`https://www.google.com/maps?q=${location.latitude},${location.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver no mapa
                  </a>
                )}
              </dl>
            )}
            {location && location.locationStatus === "DENIED" && (
              <p className="text-sm text-gray-500">Localização não autorizada pelo vendedor.</p>
            )}
            {location && ["UNAVAILABLE", "TIMEOUT", "NOT_SUPPORTED"].includes(location.locationStatus) && (
              <p className="text-sm text-gray-500">Localização indisponível no aparelho.</p>
            )}
          </div>

          {quote.origin === "CRM" && !quote.deletedAt && quote.items.length > 0 && (
            <RealOrderPanel
              quoteId={quote.id}
              customerId={quote.customer.id}
              brand={quote.brand}
              mode={quote.mode}
              status={quote.status}
              customerEmail={quote.customer.email}
              sentToEmail={quote.sentToEmail}
              realQuoteId={realQuote?.id ?? null}
              olistOrder={quote.olistOrder ? { olistOrderId: quote.olistOrder.olistOrderId, orderNumber: quote.olistOrder.orderNumber, crmStatus: quote.olistOrder.crmStatus, valueCents: quote.olistOrder.valueCents } : null}
              olistConfirmedTotalCents={olistConfirmedTotalCents}
              missing={customerOrderReadiness(quote.customer).map((m) => ({ label: m.label, level: m.level }))}
              attempts={quote.olistSyncAttempts.map((a) => ({ id: a.id, action: a.action, status: a.status, errorCode: a.errorCode, errorMessage: a.errorMessage, orderNumber: a.orderNumber, startedAt: a.startedAt.toISOString() }))}
            />
          )}

          {quote.origin === "CRM" && canEditNative && (
            <div className="card p-5 space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">Ações</h2>
              <Link href={`/cotacoes/nova?id=${quote.id}`} className={`${quote.brand === "MIBRO" ? "btn-brand-mibro" : "btn-brand-sincrofit"} w-full`}>
                Continuar no CRM
              </Link>
              <p className="text-xs text-gray-500">Mantém a tabela e a faixa com que a proposta foi calculada.</p>
            </div>
          )}

          {quote.origin === "SHOPIFY" && (canConvert || canReopen) && (
            <div className="card p-5 space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">Ações</h2>
              {canConvert && (
                <ResumeProposalButton
                  customerId={quote.customer.id}
                  resumeQuoteId={quote.id}
                  forcedMode="REAL"
                  brand={quote.brand}
                  label="Transformar em cotação real"
                />
              )}
              {canReopen && (
                <ResumeProposalButton
                  customerId={quote.customer.id}
                  resumeQuoteId={quote.id}
                  forcedMode={quote.mode}
                  brand={quote.brand}
                  label="Abrir novamente na calculadora"
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
