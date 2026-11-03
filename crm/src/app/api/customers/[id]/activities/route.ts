import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, badRequest, forbidden, notFound } from "@/lib/api-auth";
import { canAccessCustomer } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { locationInputSchema, buildLocationCaptureData } from "@/lib/location";
import { syncAutomaticFollowUpsForCustomerIds } from "@/lib/automatic-followups";

// Igual ao schema compartilhado, mas aqui userAgentSummary/deviceType são
// obrigatórios — o formulário de visita sempre os envia (heurística de
// diagnóstico já calculada no clique), diferente do fluxo de proposta.
const locationAttemptSchema = locationInputSchema.extend({
  userAgentSummary: z.string().max(120),
  deviceType: z.enum(["mobile", "tablet", "desktop"]),
});

const schema = z.object({
  type: z.enum([
    "WHATSAPP",
    "TELEFONE",
    "EMAIL",
    "VISITA",
    "REUNIAO",
    "ANOTACAO",
    "COTACAO",
    "PEDIDO",
    "PAGAMENTO",
    "VENDA",
    "CANCELAMENTO",
    "FOLLOW_UP",
  ]),
  description: z.string().min(1, "Descrição é obrigatória."),
  nextActionAt: z.string().datetime().optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  accuracyMeters: z.number().optional().nullable(),
  // Presente só quando o usuário clicou em "Registrar localização da
  // visita" (nunca automático) — ver ActivityForm. Registrado mesmo quando
  // a captura falha/é negada: isso é dado útil, distinto de "nunca
  // tentou".
  locationAttempt: locationAttemptSchema.optional().nullable(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;

  const customer = await prisma.customer.findUnique({ where: { id }, select: { sellerId: true } });
  if (!customer) return notFound("Cliente não encontrado.");
  if (!(await canAccessCustomer(user, customer.sellerId))) return forbidden();

  const activities = await prisma.customerActivity.findMany({
    where: { customerId: id },
    orderBy: { createdAt: "desc" },
    include: { seller: { select: { name: true } } },
  });

  return NextResponse.json({ activities });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;

  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) return notFound("Cliente não encontrado.");
  if (!(await canAccessCustomer(user, customer.sellerId))) return forbidden();

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Dados inválidos.", parsed.error.flatten());
  const data = parsed.data;

  const isVisita = data.type === "VISITA";
  const locationAttempt = isVisita ? data.locationAttempt ?? null : null;

  const { activity } = await prisma.$transaction(async (tx) => {
    const createdActivity = await tx.customerActivity.create({
      data: {
        customerId: id,
        sellerId: user.id,
        type: data.type,
        description: data.description,
        nextActionAt: data.nextActionAt ? new Date(data.nextActionAt) : null,
        // Localização só é preenchida em registro explícito de visita, nunca
        // rastreamento silencioso — o frontend só envia esses campos quando o
        // usuário aciona "Registrar localização da visita" e o navegador
        // concede permissão via Geolocation API. Mantido aqui (Fase 1) além
        // do LocationCapture mais rico abaixo, por compatibilidade.
        latitude: isVisita ? data.latitude ?? null : null,
        longitude: isVisita ? data.longitude ?? null : null,
        accuracyMeters: isVisita ? data.accuracyMeters ?? null : null,
      },
    });

    // Grava o LocationCapture na mesma ação do clique do usuário (mesmo
    // clique que já registra a atividade) — nunca uma chamada separada.
    // Só preenche coordenadas quando o status é GRANTED; para os demais
    // status o registro existe mesmo assim (dado útil de contexto).
    if (locationAttempt) {
      await tx.locationCapture.create({
        data: buildLocationCaptureData({
          location: locationAttempt,
          sellerId: user.id,
          customerId: id,
          locationSource: "CUSTOMER_VISIT",
          activityId: createdActivity.id,
        }),
      });
    }

    return { activity: createdActivity };
  });

  await prisma.customer.update({
    where: { id },
    data: {
      lastInteractionAt: new Date(),
      ...(data.nextActionAt ? { nextInteractionAt: new Date(data.nextActionAt) } : {}),
    },
  });
  await prisma.followUp.updateMany({
    where: {
      customerId: id,
      source: { in: ["AUTOMATICO_30_DIAS", "AUTOMATICO_INATIVIDADE"] },
      status: { in: ["PENDENTE", "ADIADO"] },
    },
    data: { status: "CONCLUIDO", completedAt: new Date() },
  });
  await syncAutomaticFollowUpsForCustomerIds([id]);

  await logAudit({
    actorId: user.id,
    action: "ACTIVITY_CREATED",
    entityType: "CustomerActivity",
    entityId: activity.id,
    metadata: {
      customerId: id,
      type: data.type,
      ...(locationAttempt ? { locationStatus: locationAttempt.status } : {}),
    },
  });

  return NextResponse.json({ activity }, { status: 201 });
}
