import { notFound, redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessCustomer, getCustomerTransferTargets } from "@/lib/authz";
import { formatCnpjOrCpf, formatPhone, formatDateTime, formatCentsToBRL } from "@/lib/format";
import Link from "next/link";
import { phoneDetails, PHONE_CHANNEL_LABELS } from "@/lib/customer-phones";
import { CommercialBrandBadge, StatusBadge, TemperatureBadge, QuoteStatusBadge, ProposalModeBadge } from "@/components/badges";
import { StatusTemperatureEditor } from "./status-editor";
import { ActivityForm } from "./activity-form";
import { CreateProposalPanel } from "./quote-session-button";
import { DeleteCustomerButton } from "./delete-customer-button";
import { ACTIVITY_TYPE_LABELS } from "@/lib/labels";
import { CustomerTransferForm } from "./customer-transfer-form";
import { BUSINESS_TYPE_LABELS, CUSTOMER_INTEREST_LABELS, INTERESTED_BRAND_LABELS } from "@/lib/customer-fields";
import { EditCustomerForm } from "./edit-customer-form";
import { CustomerPipelinePanel } from "./customer-pipeline-panel";
import { loadPipelineCardById } from "@/lib/pipeline-board";
import { PIPELINE_STAGE_META, isPipelineStage } from "@/lib/pipeline-rules";
import { regionMatchScore } from "@/lib/representative-regions";
import { commissionStatusLabel, formatCommissionPercent } from "@/lib/representative-commission";
import { SALE_STAGE_LABELS, STATUS_LABELS } from "@/lib/labels";
import { APPOINTMENT_SELECT, getAgendaViewer, getAppointmentScopeFilter, toAppointmentDTO } from "@/lib/agenda";
import { formatDateKeyBR, isOverdue, timeRangeLabel, toDateKey, typeLabel } from "@/lib/agenda-rules";
import { ScheduleAppointmentButton } from "./schedule-appointment-button";
import {centralEnabled} from '@/lib/central-identity';
import { CustomerProposals } from "@/components/customer-proposals";
import { proposalsEnabled } from "@/lib/proposals/proposal-config";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const user = { id: session!.user.id, role: session!.user.role };
  const canSeeSeller = user.role !== "VENDEDOR" && user.role !== "REPRESENTANTE";

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      seller: { select: { id: true, name: true, sellerProfile: { select: { displayName: true } } } },
      // Histórico nunca é apagado; a tela mostra os registros mais recentes.
      statusHistory: { orderBy: { createdAt: "desc" }, take: 100, include: { changedBy: { select: { name: true } } } },
      activities: { orderBy: { createdAt: "desc" }, take: 100, include: { seller: { select: { name: true, rca: true } } } },
      quotes: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: {
          // Só usado para exibir um indicador discreto "localização
          // registrada" na timeline (item 15) — nunca expõe lat/lng aqui.
          locationCaptures: {
            where: { locationSource: "PROPOSAL_SENT", locationStatus: "GRANTED" },
            select: { id: true },
            take: 1,
          },
        },
      },
      sales: {
        orderBy: { createdAt: "desc" },
        include: { olistOrder: { select: { orderNumber: true, olistOrderId: true } }, seller: { select: { name: true, rca: true } } },
      },
      transferHistory: {
        orderBy: { createdAt: "desc" },
        include: {
          fromSeller: { select: { name: true } },
          toSeller: { select: { name: true } },
          transferredBy: { select: { name: true } },
        },
      },
      tags: { orderBy: { name: "asc" } },
    },
  });

  if (!customer) notFound();
  if (!(await canAccessCustomer(user, customer.sellerId))) redirect("/clientes");
  const [targets, pipelineCard] = await Promise.all([
    getCustomerTransferTargets(user, customer.sellerId),
    loadPipelineCardById(customer.id),
  ]);
  // Quem atende a cidade/UF do cliente aparece primeiro (sem atribuição automática).
  const transferTargets = targets
    .map((target) => ({ ...target, regionScore: regionMatchScore(target.regions, customer.state, customer.city) }))
    .sort((a, b) => b.regionScore - a.regionScore || a.name.localeCompare(b.name, "pt-BR"));
  const canSeeAllCommissions = user.role === "ADMIN" || user.role === "SUPERVISOR";
  const centralLink=centralEnabled()&&user.role!=='REPRESENTANTE'?await prisma.centralIdentityLink.findUnique({where:{userId:user.id},select:{enabled:true}}):null;

  // Agenda: mesmo escopo de RBAC da tela /agenda (vendedor só vê os próprios
  // compromissos, supervisor os da equipe). Pendentes incluem atrasados.
  const appointmentScope = await getAppointmentScopeFilter(user);
  const [pendingAppointmentRows, appointmentHistory] = await Promise.all([
    prisma.appointment.findMany({
      where: { AND: [appointmentScope, { customerId: customer.id, status: "PENDENTE" }] },
      select: APPOINTMENT_SELECT,
      orderBy: { startsAt: "asc" },
      take: 5,
    }),
    prisma.appointment.findMany({
      where: { AND: [appointmentScope, { customerId: customer.id }] },
      select: {
        id: true, type: true, title: true, startsAt: true, endsAt: true, allDay: true, status: true,
        createdAt: true, completedAt: true, cancelledAt: true,
        createdBy: { select: { name: true } },
        completedBy: { select: { name: true } },
        cancelledBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  const agendaViewer = await getAgendaViewer(user);
  const pendingAppointments = pendingAppointmentRows.map((row) => toAppointmentDTO(row, agendaViewer));
  const nextFollowUp = pendingAppointments.find((item) => item.type === "FOLLOW_UP") ?? null;
  const otherAppointments = pendingAppointments.filter((item) => item !== nextFollowUp).slice(0, 3);
  const agendaHref = (item: { id: string; startsAt: string | Date }) =>
    `/agenda?view=hoje&date=${toDateKey(item.startsAt)}&open=${item.id}`;

  // Linha do tempo única: atividades já existentes + eventos da Agenda
  // (criado/concluído/cancelado), derivados dos próprios compromissos — sem
  // gravar registros duplicados em CustomerActivity.
  type TimelineEntry =
    | { key: string; at: Date; kind: "activity"; activity: (typeof customer.activities)[number] }
    | { key: string; at: Date; kind: "appointment"; label: string; detail: string; by: string | null; href: string };
  const appointmentEvents: TimelineEntry[] = appointmentHistory.flatMap((item) => {
    const when = `${formatDateKeyBR(toDateKey(item.startsAt))} · ${timeRangeLabel(item)}`;
    const base = { kind: "appointment" as const, detail: `${item.title} — ${when}`, href: agendaHref(item) };
    const events: TimelineEntry[] = [
      { ...base, key: `${item.id}:created`, at: item.createdAt, label: `Agendado — ${typeLabel(item.type)}`, by: item.createdBy.name },
    ];
    if (item.status === "CONCLUIDO" && item.completedAt) {
      events.push({ ...base, key: `${item.id}:done`, at: item.completedAt, label: `Concluído — ${typeLabel(item.type)}`, by: item.completedBy?.name ?? null });
    }
    if (item.status === "CANCELADO" && item.cancelledAt) {
      events.push({ ...base, key: `${item.id}:cancelled`, at: item.cancelledAt, label: `Cancelado — ${typeLabel(item.type)}`, by: item.cancelledBy?.name ?? null });
    }
    return events;
  });
  const timeline: TimelineEntry[] = [
    ...customer.activities.map((activity) => ({ key: activity.id, at: activity.createdAt, kind: "activity" as const, activity })),
    ...appointmentEvents,
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 100);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold text-gray-900">{customer.tradeName || customer.contactName}</h1>
          <p className="text-sm text-gray-500">{customer.legalName}{canSeeSeller ? ` · Vendedor: ${customer.seller.sellerProfile?.displayName ?? customer.seller.name}` : ""}</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
        {centralLink?.enabled?<Link href={`/atendimento?customerId=${encodeURIComponent(customer.id)}`} prefetch={false} className="btn-secondary">Conversas no Atendimento</Link>:null}
        <ScheduleAppointmentButton
          customer={{ id: customer.id, name: customer.tradeName || customer.contactName }}
          currentUser={{ id: user.id, name: session!.user.name ?? "Você", role: user.role }}
        />
        <EditCustomerForm customer={{
          phone2Digits: customer.phone2Digits, phone3Digits: customer.phone3Digits, phoneChannel: customer.phoneChannel, phone2Channel: customer.phone2Channel, phone3Channel: customer.phone3Channel,
          id: customer.id, contactName: customer.contactName, legalName: customer.legalName, tradeName: customer.tradeName,
          cnpjDigits: customer.cnpjDigits, cpfDigits: customer.cpfDigits, email: customer.email, phoneDigits: customer.phoneDigits,
          addressStreet: customer.addressStreet, addressNumber: customer.addressNumber, addressDistrict: customer.addressDistrict,
          addressComplement: customer.addressComplement,
          city: customer.city, state: customer.state, spRegion: customer.spRegion, zipDigits: customer.zipDigits, leadOrigin: customer.leadOrigin,
          businessType: customer.businessType, industrySegment: customer.industrySegment, worksWithSmartwatch: customer.worksWithSmartwatch,
          interests: customer.interests, interestedBrand: customer.interestedBrand, leadCapturedAt: customer.leadCapturedAt?.toISOString() ?? null,
          notes: customer.notes,
        }} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Dados do cliente</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-gray-400">Nome do contato</dt>
                <dd className="text-gray-800">{customer.contactName}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Nome fantasia</dt>
                <dd className="text-gray-800">{customer.tradeName || "-"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-gray-400">Razão social</dt>
                <dd className="text-gray-800">{customer.legalName || "-"}</dd>
              </div>
              <div>
                <dt className="text-gray-400">CNPJ</dt>
                <dd className="text-gray-800">{formatCnpjOrCpf(customer.cnpjDigits) || "-"}</dd>
              </div>
              <div>
                <dt className="text-gray-400">CPF</dt>
                <dd className="text-gray-800">{formatCnpjOrCpf(customer.cpfDigits) || "-"}</dd>
              </div>
              <div>
                <dt className="text-gray-400">E-mail</dt>
                <dd className="text-gray-800">{customer.email ? <a className="text-blue-600 hover:underline" href={`mailto:${customer.email}`}>{customer.email}</a> : "-"}</dd>
              </div>
              {[[customer.phoneDigits, customer.phoneChannel], [customer.phone2Digits, customer.phone2Channel], [customer.phone3Digits, customer.phone3Channel]].map(([number, channel], index) => {
                const details = phoneDetails(number);
                return <div key={index}><dt className="text-gray-400">Telefone {index + 1}</dt><dd className="text-gray-800">{number ? <><a href={details.telephoneUrl!} className="underline">{formatPhone(number)}</a><span className="block">{details.kind}{channel ? ` · ${PHONE_CHANNEL_LABELS[channel]}` : ""}</span>{channel !== "PHONE" && details.whatsappUrl && <a className="underline" href={details.whatsappUrl} target="_blank" rel="noreferrer">Abrir WhatsApp</a>}</> : "-"}</dd></div>;
              })}
              <div>
                <dt className="text-gray-400">Endereço</dt>
                <dd className="text-gray-800">{[customer.addressStreet, customer.addressNumber, customer.addressComplement].filter(Boolean).join(", ") || "-"}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Bairro</dt>
                <dd className="text-gray-800">{customer.addressDistrict || "-"}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Cidade/UF</dt>
                <dd className="text-gray-800">{[customer.city, customer.state].filter(Boolean).join("/") || "-"}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Região de São Paulo</dt>
                <dd className="text-gray-800">{customer.spRegion || "-"}</dd>
              </div>
              <div>
                <dt className="text-gray-400">CEP</dt>
                <dd className="text-gray-800">{customer.zipDigits || "-"}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Tipo de negócio</dt>
                <dd className="text-gray-800">{customer.businessType ? BUSINESS_TYPE_LABELS[customer.businessType] : "-"}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Segmento de atuação</dt>
                <dd className="text-gray-800">{customer.industrySegment || "-"}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Já trabalha com Smartwatch</dt>
                <dd className="text-gray-800">{customer.worksWithSmartwatch == null ? "Não informado" : customer.worksWithSmartwatch ? "Sim" : "Não"}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Empresa de interesse</dt>
                <dd className="text-gray-800">{customer.interestedBrand ? INTERESTED_BRAND_LABELS[customer.interestedBrand] : "-"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-gray-400">Produtos de interesse</dt>
                <dd className="text-gray-800">{customer.interests.length ? customer.interests.map((interest) => CUSTOMER_INTEREST_LABELS[interest]).join(", ") : "-"}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Origem do lead</dt>
                <dd className="text-gray-800">{customer.leadOrigin || "-"}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Carimbo original/importação</dt>
                <dd className="text-gray-800">{customer.leadCapturedAt ? formatDateTime(customer.leadCapturedAt) : "-"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-gray-400">Tags</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {customer.tags.length ? customer.tags.map((tag) => <span key={tag.id} className="rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: tag.color }}>{tag.name}</span>) : <span className="text-gray-800">-</span>}
                </dd>
              </div>
            </dl>
            {customer.notes && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <dt className="text-gray-400 text-sm">Observações</dt>
                <dd className="text-gray-700 text-sm">{customer.notes}</dd>
              </div>
            )}
          </div>

          <div className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Datas e movimentação</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-gray-400">Cadastrado no CRM</dt><dd className="text-gray-800">{formatDateTime(customer.createdAt)}</dd></div>
              <div><dt className="text-gray-400">Última atualização</dt><dd className="text-gray-800">{formatDateTime(customer.updatedAt)}</dd></div>
              <div><dt className="text-gray-400">Última interação</dt><dd className="text-gray-800">{customer.lastInteractionAt ? formatDateTime(customer.lastInteractionAt) : "-"}</dd></div>
              <div><dt className="text-gray-400">Próxima interação</dt><dd className="text-gray-800">{customer.nextInteractionAt ? formatDateTime(customer.nextInteractionAt) : "-"}</dd></div>
              <div><dt className="text-gray-400">Última venda</dt><dd className="text-gray-800">{customer.lastSaleAt ? formatDateTime(customer.lastSaleAt) : "-"}</dd></div>
              <div><dt className="text-gray-400">Total vendido</dt><dd className="text-gray-800">{formatCentsToBRL(customer.totalSoldCents)}</dd></div>
              <div><dt className="text-gray-400">Vendedor responsável</dt><dd className="text-gray-800">{customer.seller.sellerProfile?.displayName ?? customer.seller.name}</dd></div>
            </dl>
          </div>

          {transferTargets.length > 0 && (
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Repassar cliente</h2>
              <CustomerTransferForm customerId={customer.id} targets={transferTargets} />
            </div>
          )}

          {customer.transferHistory.length > 0 && (
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Histórico de repasses</h2>
              <ul className="space-y-2 text-xs text-gray-500">
                {customer.transferHistory.map((transfer) => (
                  <li key={transfer.id}>
                    {transfer.fromSeller.name} → {transfer.toSeller.name} por {transfer.transferredBy.name} ·{" "}
                    {formatDateTime(transfer.createdAt)}
                    {transfer.reason ? ` · ${transfer.reason}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Registrar atividade</h2>
            <ActivityForm customerId={customer.id} />
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Linha do tempo</h2>
            <ul className="space-y-3">
              {timeline.map((entry) => entry.kind === "appointment" ? (
                <li key={entry.key} className="border-l-2 border-orange-200 pl-3">
                  <p className="text-sm font-medium text-gray-800">
                    {entry.label}
                    <span className="ml-2 text-xs font-normal text-gray-400">Agenda</span>
                  </p>
                  <p className="text-sm text-gray-600">
                    <Link href={entry.href} className="hover:underline">{entry.detail}</Link>
                  </p>
                  <p className="text-xs text-gray-400">{entry.by ? `${entry.by} · ` : ""}{formatDateTime(entry.at)}</p>
                </li>
              ) : (
                <ActivityTimelineItem key={entry.key} activity={entry.activity} />
              ))}
              {timeline.length === 0 && (
                <p className="text-sm text-gray-400">Nenhuma atividade registrada ainda.</p>
              )}
            </ul>
          </div>

          {proposalsEnabled() && <CustomerProposals customerId={customer.id} user={user} />}

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              {proposalsEnabled() ? "Cotações e simulações" : "Propostas"} ({customer.quotes.length})
            </h2>
            <ul className="divide-y divide-gray-100">
              {customer.quotes.map((q) => (
                <li key={q.id} className="py-3">
                  <Link href={`/cotacoes/${q.id}`} className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <CommercialBrandBadge brand={q.brand} />
                        <ProposalModeBadge mode={q.mode} />
                        <QuoteStatusBadge status={q.status} />
                      </div>
                      <p className="text-xs text-gray-400">
                        {formatDateTime(q.createdAt)}
                        {q.locationCaptures.length > 0 ? " · Localização registrada" : ""}
                      </p>
                    </div>
                    <p className="text-sm font-medium text-gray-800">
                      {q.totalValueCents ? formatCentsToBRL(q.totalValueCents) : "-"}
                    </p>
                  </Link>
                </li>
              ))}
              {customer.quotes.length === 0 && (
                <p className="text-sm text-gray-400">Nenhuma proposta registrada ainda.</p>
              )}
            </ul>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-700">Agenda</h2>
              <Link href={`/agenda?view=lista`} className="text-xs text-gray-500 hover:underline">Ver agenda</Link>
            </div>
            {nextFollowUp ? (
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Próximo follow-up</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {formatDateKeyBR(toDateKey(nextFollowUp.startsAt))}{nextFollowUp.allDay ? "" : ` às ${timeRangeLabel(nextFollowUp)}`}
                </p>
                <p className="text-sm text-gray-600">{nextFollowUp.title}</p>
                {isOverdue(nextFollowUp) && <p className="text-xs font-medium text-amber-700">⚠ Atrasado</p>}
                <Link href={agendaHref(nextFollowUp)} className="mt-2 inline-block text-xs font-medium text-gray-700 underline">Abrir na agenda</Link>
              </div>
            ) : (
              <p className="text-sm text-gray-400">Nenhum follow-up agendado.</p>
            )}
            {otherAppointments.length > 0 && (
              <ul className="mt-3 space-y-2">
                {otherAppointments.map((item) => (
                  <li key={item.id} className="text-sm">
                    <Link href={agendaHref(item)} className="block hover:underline">
                      <span className="tabular-nums text-gray-500">{formatDateKeyBR(toDateKey(item.startsAt)).slice(0, 5)} · {timeRangeLabel(item)}</span>{" "}
                      <span className="text-gray-800">{typeLabel(item.type)} — {item.title}</span>
                      {isOverdue(item) && <span className="ml-1 text-xs text-amber-700">⚠ Atrasado</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {pipelineCard && (
            <div className="card p-5">
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Funil comercial</h2>
              <CustomerPipelinePanel card={pipelineCard} />
            </div>
          )}

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Status comercial</h2>
            <div className="flex flex-col gap-2 mb-3">
              <StatusBadge status={customer.status} />
              <TemperatureBadge temperature={customer.temperature} />
            </div>
            <StatusTemperatureEditor
              customerId={customer.id}
              currentStatus={customer.status}
              currentTemperature={customer.temperature}
            />
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Histórico de etapa e status</h2>
            <ul className="space-y-2 text-xs text-gray-500 max-h-80 overflow-y-auto">
              {customer.statusHistory.map((h) => {
                const label = (value: string | null) => !value ? "—"
                  : h.field === "PIPELINE_STAGE" && isPipelineStage(value) ? PIPELINE_STAGE_META[value].label
                  : h.field === "STATUS" ? STATUS_LABELS[value] ?? value : value;
                return (
                  <li key={h.id}>
                    <span className="font-medium text-gray-700">
                      {h.field === "PIPELINE_STAGE" ? "Etapa" : h.field === "STATUS" ? "Status" : "Temperatura"}:
                    </span>{" "}
                    {label(h.oldValue)} → {label(h.newValue)} ({h.changedBy.name}{h.changedByRca ? `, RCA ${h.changedByRca}` : ""}, {formatDateTime(h.createdAt)}{h.commercialCycle ? `, ciclo ${h.commercialCycle}` : ""})
                    {h.reason && <span className="block text-gray-400">Motivo: {h.reason}</span>}
                  </li>
                );
              })}
              {customer.statusHistory.length === 0 && <p>Sem alterações registradas.</p>}
            </ul>
          </div>

          {customer.sales.length > 0 && (
            <div className="card p-5">
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Pedidos e comissão</h2>
              <ul className="space-y-3 text-xs">
                {customer.sales.map((sale) => {
                  const showCommission = canSeeAllCommissions || sale.sellerId === user.id;
                  return (
                    <li key={sale.id} className="border-l-2 border-emerald-200 pl-3">
                      <p className="font-medium text-gray-800">
                        {sale.olistOrder?.orderNumber || sale.olistOrder?.olistOrderId ? `Pedido #${sale.olistOrder?.orderNumber || sale.olistOrder?.olistOrderId}` : "Pedido"} · {formatCentsToBRL(sale.valueCents)}
                      </p>
                      <p className="text-gray-500">{SALE_STAGE_LABELS[sale.stage] ?? sale.stage} · {formatDateTime(sale.confirmedAt ?? sale.createdAt)} · {sale.seller.name}{sale.seller.rca ? ` (RCA ${sale.seller.rca})` : ""}</p>
                      {showCommission && sale.commissionSource !== null && (
                        <p className="text-gray-600">
                          Comissão {formatCommissionPercent(sale.commissionRateBps)} · {sale.commissionCents !== null ? formatCentsToBRL(sale.commissionCents) : "a definir"} · {commissionStatusLabel(sale, sale.commissionRateBps)}
                          {sale.commissionSource === "CUSTOM_ORDER" ? " · específica do pedido" : " · padrão"}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div id="criar-proposta" className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Criar proposta</h2>
            <p className="text-xs text-gray-500 mb-3">{customer.sales.length} venda(s) confirmada(s)</p>
            <Link href={`/cotacoes/nova?cliente=${customer.id}`} className="btn-secondary mb-3 w-full">
              Nova cotação no CRM
            </Link>
            <CreateProposalPanel key={customer.id} customerId={customer.id} />
          </div>

          {user.role === "ADMIN" && (
            <div className="card border border-red-100 p-5">
              <h2 className="mb-1 text-sm font-semibold text-red-700">Área do administrador</h2>
              <p className="mb-3 text-xs text-gray-500">
                A exclusão remove definitivamente este cliente e seu histórico do CRM.
              </p>
              <DeleteCustomerButton
                customerId={customer.id}
                customerName={customer.tradeName || customer.contactName}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type TimelineActivity = Prisma.CustomerActivityGetPayload<{ include: { seller: { select: { name: true; rca: true } } } }>;

function ActivityTimelineItem({ activity: a }: { activity: TimelineActivity }) {
  return (
    <li className="border-l-2 border-brand-200 pl-3">
      <p className="text-sm font-medium text-gray-800">
        {a.isContactAttempt ? `Tentativa de contato · ${ACTIVITY_TYPE_LABELS[a.type] ?? a.type}` : ACTIVITY_TYPE_LABELS[a.type] ?? a.type}
        {a.commercialCycle && <span className="ml-2 text-xs font-normal text-gray-400">ciclo {a.commercialCycle}</span>}
      </p>
      <p className="text-sm text-gray-600">{a.description}</p>
      <p className="text-xs text-gray-400">
        {a.seller.name}{a.seller.rca ? ` (RCA ${a.seller.rca})` : ""} · {formatDateTime(a.createdAt)}
        {a.latitude && a.longitude ? ` · localização registrada` : ""}
      </p>
    </li>
  );
}
