import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, forbidden } from "@/lib/api-auth";
import type { Prisma } from "@prisma/client";

// Dados geográficos comerciais para /admin/mapa. Rota restrita a ADMIN,
// validado aqui no backend (nunca só escondida no menu) — mesmo padrão das
// outras rotas /api/admin/*... deste projeto.
//
// "Cidade atendida" usa Customer.city (texto já cadastrado no CRM) em vez de
// geocodificação reversa das coordenadas — mais simples, sem dependência
// externa paga, e suficiente para a visão gerencial pedida aqui.

function parsePeriod(searchParams: URLSearchParams): { from: Date; to: Date } {
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  if (fromParam && toParam) {
    const from = new Date(fromParam);
    const to = new Date(toParam);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
      return { from, to };
    }
  }
  // Padrão: mês corrente.
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to };
}

export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "ADMIN") return forbidden("Apenas administradores acessam o mapa comercial.");

  const sp = req.nextUrl.searchParams;
  const { from, to } = parsePeriod(sp);
  const sellerId = sp.get("sellerId") || undefined;
  const q = sp.get("q")?.trim() || undefined;
  const quoteStatus = sp.get("quoteStatus") || undefined;
  const saleConfirmed = sp.get("saleConfirmed"); // "true" | "false" | null
  const minValueCents = sp.get("minValueCents") ? Number(sp.get("minValueCents")) : undefined;
  const maxValueCents = sp.get("maxValueCents") ? Number(sp.get("maxValueCents")) : undefined;
  // Tipo da proposta (item 13 do plano de localização): SIMULATION/REAL.
  // Só se aplica a pontos com Quote — força quoteId presente igual aos
  // demais filtros de Quote abaixo.
  const mode = sp.get("mode") || undefined; // "SIMULATION" | "REAL" | undefined
  // Origem da captura: distingue visita presencial (CUSTOMER_VISIT) de
  // localização de proposta (PROPOSAL_STARTED/PROPOSAL_SENT). Sem filtro,
  // mostra todas juntas no mapa (comportamento anterior preservado).
  const locationSource = sp.get("locationSource") || undefined;

  const customerFilter: Prisma.CustomerWhereInput = {
    ...(q
      ? {
          OR: [
            { contactName: { contains: q, mode: "insensitive" as const } },
            { tradeName: { contains: q, mode: "insensitive" as const } },
            { legalName: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(saleConfirmed === "true" ? { sales: { some: { confirmedAt: { not: null } } } } : {}),
    ...(saleConfirmed === "false" ? { sales: { none: { confirmedAt: { not: null } } } } : {}),
  };

  const quoteFilter: Prisma.QuoteWhereInput | undefined =
    quoteStatus || minValueCents !== undefined || maxValueCents !== undefined || mode
      ? {
          ...(quoteStatus ? { status: quoteStatus as never } : {}),
          ...(minValueCents !== undefined ? { totalValueCents: { gte: minValueCents } } : {}),
          ...(maxValueCents !== undefined ? { totalValueCents: { lte: maxValueCents } } : {}),
          ...(mode ? { mode: mode as never } : {}),
        }
      : undefined;

  // Só capturas com coordenada real (GRANTED) viram marcador no mapa.
  const pointsWhere: Prisma.LocationCaptureWhereInput = {
    locationStatus: "GRANTED",
    createdAt: { gte: from, lte: to },
    ...(sellerId ? { sellerId } : {}),
    ...(locationSource ? { locationSource: locationSource as never } : {}),
    customer: customerFilter,
    ...(quoteFilter ? { quote: quoteFilter } : quoteStatus || minValueCents !== undefined || maxValueCents !== undefined || mode ? { quoteId: { not: null } } : {}),
  };

  const points = await prisma.locationCapture.findMany({
    where: pointsWhere,
    select: {
      id: true,
      latitude: true,
      longitude: true,
      accuracyMeters: true,
      capturedAt: true,
      createdAt: true,
      locationSource: true,
      customer: {
        select: {
          id: true,
          contactName: true,
          tradeName: true,
          city: true,
          state: true,
        },
      },
      seller: {
        select: {
          id: true,
          name: true,
          sellerProfile: { select: { displayName: true } },
        },
      },
      quote: {
        select: { id: true, status: true, totalValueCents: true, mode: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });

  // Métricas do topo da página — mesmo conjunto de filtros de vendedor/
  // período/cliente, mas sem exigir GRANTED (uma tentativa negada/perdida
  // ainda é "atividade registrada").
  const attemptsWhere: Prisma.LocationCaptureWhereInput = {
    locationSource: "CUSTOMER_VISIT",
    createdAt: { gte: from, lte: to },
    ...(sellerId ? { sellerId } : {}),
    customer: customerFilter,
  };

  const [presencialCount, distinctSellers, citySet] = await Promise.all([
    prisma.locationCapture.count({ where: attemptsWhere }),
    prisma.locationCapture.findMany({
      where: attemptsWhere,
      select: { sellerId: true },
      distinct: ["sellerId"],
    }),
    prisma.locationCapture.findMany({
      where: { ...attemptsWhere, locationStatus: "GRANTED" },
      select: { customer: { select: { city: true } } },
    }),
  ]);

  const citiesAttended = new Set(
    citySet.map((c) => c.customer?.city).filter((c): c is string => !!c && c.trim().length > 0)
  ).size;

  // Valor proposto / vendido por região (Customer.state). Prisma não agrupa
  // por campo de relação (groupBy só cobre campos escalares do próprio
  // model), então buscamos as linhas com o estado do cliente incluído e
  // agregamos em memória — volume de dados do CRM é pequeno o suficiente
  // para isso ser simples e correto.
  const [quotesInPeriod, salesInPeriod] = await Promise.all([
    prisma.quote.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        ...(sellerId ? { sellerId } : {}),
        totalValueCents: { not: null },
      },
      select: { totalValueCents: true, customer: { select: { state: true } } },
    }),
    prisma.sale.findMany({
      where: {
        confirmedAt: { gte: from, lte: to },
        ...(sellerId ? { sellerId } : {}),
      },
      select: { valueCents: true, customer: { select: { state: true } } },
    }),
  ]);

  function sumByState(rows: { valueCents?: number | null; totalValueCents?: number | null; customer: { state: string | null } }[]) {
    const map = new Map<string, number>();
    for (const row of rows) {
      const state = row.customer.state || "Não informado";
      const value = row.valueCents ?? row.totalValueCents ?? 0;
      map.set(state, (map.get(state) ?? 0) + value);
    }
    return Array.from(map.entries())
      .map(([state, valueCents]) => ({ state, valueCents }))
      .sort((a, b) => b.valueCents - a.valueCents);
  }

  const proposedByState = sumByState(quotesInPeriod);
  const soldByState = sumByState(salesInPeriod);

  const sellers = await prisma.user.findMany({
    where: { role: { in: ["VENDEDOR", "REPRESENTANTE", "SUPERVISOR"] } },
    select: { id: true, name: true, sellerProfile: { select: { displayName: true } } },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    points: points.map((p) => ({
      id: p.id,
      latitude: p.latitude,
      longitude: p.longitude,
      accuracyMeters: p.accuracyMeters,
      capturedAt: p.capturedAt ?? p.createdAt,
      locationSource: p.locationSource,
      customer: {
        id: p.customer?.id,
        name: p.customer ? p.customer.tradeName || p.customer.contactName : "Cliente removido",
        city: p.customer?.city ?? null,
        state: p.customer?.state ?? null,
      },
      seller: {
        id: p.seller.id,
        name: p.seller.sellerProfile?.displayName ?? p.seller.name,
      },
      quote: p.quote ? { id: p.quote.id, status: p.quote.status, totalValueCents: p.quote.totalValueCents, mode: p.quote.mode } : null,
    })),
    metrics: {
      presencialCount,
      activeSellersCount: distinctSellers.length,
      citiesAttended,
      proposedByState,
      soldByState,
    },
    sellers: sellers.map((s) => ({ id: s.id, name: s.sellerProfile?.displayName ?? s.name })),
    period: { from: from.toISOString(), to: to.toISOString() },
  });
}
