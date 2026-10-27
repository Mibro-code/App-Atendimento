import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatCentsToBRL, formatDateTime } from "@/lib/format";
import { QUOTE_STATUS_LABELS, PROPOSAL_MODE_LABELS } from "@/lib/labels";
import { EditSellerForm } from "./edit-seller-form";
import { SellerLocationsMap } from "./seller-locations-map";
import { DeleteUserButton } from "./delete-user-button";
import { RepresentativeProfileEditor } from "@/components/representative-profile-editor";
import type { MapPoint } from "../../mapa/types";

export default async function EditSellerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, supervisors, locationCaptures] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        rca: true,
        role: true,
        active: true,
        deletedAt: true,
        representativeRegions: { select: { state: true, city: true }, orderBy: [{ state: "asc" }, { city: "asc" }] },
        supervisorId: true,
        followUpAfterDays: true,
        allowSellerCustomerTransfer: true,
        canTransferOwnCustomers: true,
        canCreateTeamUsers: true,
        timeClockReminderEnabled:true,timeClockRequiredEvents:true,timeClockWorkingDays:true,
        timeClockStartMinutes:true,timeClockLunchStartMinutes:true,timeClockLunchEndMinutes:true,
        timeClockEndMinutes:true,timeClockReminderIntervalMinutes:true,
        sellerProfile: {
          select: {
            displayName: true,
            phone: true,
            whatsapp: true,
            jobTitle: true,
            region: true,
            monthlyGoalCents: true,
            internalNotes: true,
            representativeType: true,
          },
        },
      },
    }),
    prisma.user.findMany({
      where: { role: { in: ["SUPERVISOR", "ADMIN"] }, id: { not: id } },
      select: { id: true, name: true },
    }),
    // Localizações da proposta (item 14 do plano) — só histórico de locais
    // onde este vendedor registrou visita/proposta com localização
    // autorizada (GRANTED). Nunca é "posição atual": não há rastreamento em
    // tempo real, só o que já foi capturado em ações comerciais passadas.
    prisma.locationCapture.findMany({
      where: {
        sellerId: id,
        locationStatus: "GRANTED",
        locationSource: { in: ["PROPOSAL_STARTED", "PROPOSAL_SENT", "CUSTOMER_VISIT"] },
      },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        accuracyMeters: true,
        capturedAt: true,
        createdAt: true,
        locationSource: true,
        customer: { select: { id: true, contactName: true, tradeName: true, city: true, state: true } },
        seller: { select: { id: true, name: true, sellerProfile: { select: { displayName: true } } } },
        quote: { select: { id: true, status: true, totalValueCents: true, mode: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
  ]);

  if (!user) notFound();

  const points: MapPoint[] = locationCaptures.map((p) => ({
    id: p.id,
    latitude: p.latitude,
    longitude: p.longitude,
    accuracyMeters: p.accuracyMeters,
    capturedAt: (p.capturedAt ?? p.createdAt).toISOString(),
    locationSource: p.locationSource,
    customer: {
      id: p.customer?.id,
      name: p.customer ? p.customer.tradeName || p.customer.contactName : "Cliente removido",
      city: p.customer?.city ?? null,
      state: p.customer?.state ?? null,
    },
    seller: { id: p.seller.id, name: p.seller.sellerProfile?.displayName ?? p.seller.name },
    quote: p.quote
      ? { id: p.quote.id, status: p.quote.status, totalValueCents: p.quote.totalValueCents, mode: p.quote.mode }
      : null,
  }));

  return (
    <div className="max-w-4xl space-y-6">
      <div className="max-w-xl">
        <h1 className="text-xl font-semibold text-gray-900 mb-1">{user.name}</h1>
        <p className="text-sm text-gray-500 mb-6">{user.email}{user.rca ? ` · RCA ${user.rca}` : ""}</p>
        <div className="card p-6 mb-6">
          {user.deletedAt ? <p className="text-sm text-red-700">Esta conta foi excluída em {formatDateTime(user.deletedAt)}. Os registros foram preservados somente para histórico.</p> : <EditSellerForm user={user} supervisors={supervisors} />}
        </div>
        {!user.deletedAt && user.role === "REPRESENTANTE" && (
          <div className="card mb-6 p-6">
            <h2 className="text-sm font-semibold text-gray-800">Representante: tipo e regiões de atendimento</h2>
            <RepresentativeProfileEditor userId={user.id} initial={{ representativeType: user.sellerProfile?.representativeType ?? null, regions: user.representativeRegions }} />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Link href={`/cotacoes?sellerId=${user.id}`} className="btn-secondary inline-block">Ver propostas deste vendedor</Link>
          <Link href={`/contas/${user.id}/historico`} className="btn-secondary inline-block">Histórico da conta</Link>
          {!user.deletedAt && <DeleteUserButton userId={user.id} userName={user.name} />}
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Localizações</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Histórico de locais registrados em visitas e propostas com localização autorizada — não é a posição
            atual do vendedor, não há rastreamento em tempo real.
          </p>
        </div>
        <div className="h-[360px]">
          <SellerLocationsMap points={points} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Data/hora</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Proposta</th>
                <th className="px-3 py-2 font-medium text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {locationCaptures.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2">
                    {p.customer ? (
                      <Link href={`/clientes/${p.customer.id}`} className="text-brand hover:underline">
                        {p.customer.tradeName || p.customer.contactName}
                      </Link>
                    ) : (
                      "Cliente removido"
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-500">{formatDateTime(p.capturedAt ?? p.createdAt)}</td>
                  <td className="px-3 py-2 text-gray-500">
                    {p.quote ? PROPOSAL_MODE_LABELS[p.quote.mode] ?? p.quote.mode : "Visita"}
                  </td>
                  <td className="px-3 py-2">
                    {p.quote ? (
                      <Link href={`/cotacoes/${p.quote.id}`} className="text-brand hover:underline">
                        {QUOTE_STATUS_LABELS[p.quote.status] ?? p.quote.status}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {p.quote?.totalValueCents != null ? formatCentsToBRL(p.quote.totalValueCents) : "-"}
                  </td>
                </tr>
              ))}
              {locationCaptures.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-gray-400">
                    Nenhuma localização registrada para este vendedor ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
