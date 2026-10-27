import { Prisma } from "@prisma/client";
import {verifyCurrentPassword} from '@/lib/primary-password';
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, badRequest, forbidden } from "@/lib/api-auth";
import { locationInputSchema } from "@/lib/location";
import { prisma } from "@/lib/prisma";
import {
  canUseTimeClock,
  getBrazilWorkDate,
  getExpectedClockOutAt,
  isEarlyDeparture,
  timeClockEventValues,
} from "@/lib/time-clock";
import { getWebAuthnConfig, validChallenge } from "@/lib/webauthn";

export const runtime = "nodejs";

function monthDateRange(monthParam: string): { from: Date; to: Date } {
  const from = new Date(`${monthParam}-01T00:00:00.000Z`);
  const to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + 1);
  return { from, to };
}

const earlyDepartureReasonValues = [
  "COMPROMISSO",
  "EMERGENCIA",
  "PROBLEMA_PESSOAL",
  "AUTORIZACAO_SUPERVISOR",
  "OUTRO",
] as const;

const createSchema = z.object({
  eventType: z.enum(timeClockEventValues),
  // Localização é sempre solicitada no clique (ver requestLocationAttempt no
  // client) — por isso deixou de ser opcional aqui. Quando negada/indisponível
  // o `status` ainda chega (GRANTED/DENIED/UNAVAILABLE/TIMEOUT/NOT_SUPPORTED)
  // e o ponto é registrado do mesmo jeito, sem inventar coordenadas.
  location: locationInputSchema,
  // Só exigido quando o servidor detecta CLOCK_OUT antecipado (ver abaixo) —
  // nunca confiamos numa flag "isEarly" enviada pelo cliente.
  earlyDeparture: z
    .object({
      reason: z.enum(earlyDepartureReasonValues),
      description: z.string().trim().min(1).max(1000),
    })
    .optional(),
  verification: z.discriminatedUnion("type", [
    z.object({ type: z.literal("password"), password: z.string().min(1).max(500) }),
    z.object({ type: z.literal("passkey"), response: z.unknown() }),
  ]),
});

const entrySelect = {
  id: true,
  eventType: true,
  workDate: true,
  occurredAt: true,
  locationStatus: true,
  latitude: true,
  longitude: true,
  accuracyMeters: true,
} satisfies Prisma.TimeClockEntrySelect;

export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (!canUseTimeClock(user.role)) return forbidden("Ponto disponível somente para vendedores e supervisores.");

  const monthParam = req.nextUrl.searchParams.get("month"); // "YYYY-MM", opcional
  const workDate = getBrazilWorkDate();
  const monthRange = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthDateRange(monthParam) : null;

  const [today, recent, monthEntries] = await Promise.all([
    prisma.timeClockEntry.findMany({
      where: { userId: user.id, workDate },
      orderBy: { occurredAt: "asc" },
      select: entrySelect,
    }),
    prisma.timeClockEntry.findMany({
      where: { userId: user.id },
      orderBy: { occurredAt: "desc" },
      take: 28,
      select: entrySelect,
    }),
    monthRange
      ? prisma.timeClockEntry.findMany({
          where: { userId: user.id, workDate: { gte: monthRange.from, lt: monthRange.to } },
          orderBy: { occurredAt: "asc" },
          select: entrySelect,
        })
      : Promise.resolve(null),
  ]);

  return NextResponse.json({ today, recent, month: monthEntries });
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (!canUseTimeClock(user.role)) return forbidden("Ponto disponível somente para vendedores e supervisores.");

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Registro de ponto inválido.", parsed.error.flatten());

  const now = new Date();
  const workDate = getBrazilWorkDate(now);
  const { eventType, location, earlyDeparture } = parsed.data;
  const granted = location.status === "GRANTED";
  const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const requiresEarlyDeparture = eventType === "CLOCK_OUT" && isEarlyDeparture(now, workDate);

  // Servidor recalcula de forma independente — nunca confia em uma flag do
  // cliente dizendo "isso é antecipado". Se for CLOCK_OUT antes do horário
  // esperado e a justificativa não veio no corpo, pede ela antes de criar
  // qualquer registro (o front abre o modal com este código de erro).
  if (requiresEarlyDeparture && !earlyDeparture) {
    return NextResponse.json(
      {
        error: "Você está encerrando seu expediente antes do horário previsto. Informe uma justificativa.",
        code: "EARLY_DEPARTURE_JUSTIFICATION_REQUIRED",
      },
      { status: 422 }
    );
  }

  const account = await prisma.user.findFirst({
    where: { id: user.id, active: true, deletedAt: null },
    select: {
      passwordHash: true,
      webAuthnChallenge: true,
      webAuthnChallengePurpose: true,
      webAuthnChallengeExpiresAt: true,
    },
  });
  if (!account) return forbidden("Conta desativada ou excluída.");

  let authenticationMethod: "PASSWORD" | "PASSKEY";
  if (parsed.data.verification.type === "password") {
    const passwordOk = await verifyCurrentPassword(user.id,parsed.data.verification.password);
    if (!passwordOk) return forbidden("Senha incorreta. O ponto não foi registrado.");
    authenticationMethod = "PASSWORD";
  } else {
    const purpose = `TIME_CLOCK:${eventType}`;
    if (!validChallenge(account, purpose)) return badRequest("A confirmação por digital/passkey expirou. Tente novamente.");
    const response = parsed.data.verification.response as { id?: string; response?: unknown } | null;
    if (!response?.id) return badRequest("Resposta da digital/passkey inválida.");
    const credential = await prisma.passkeyCredential.findFirst({ where: { id: response.id, userId: user.id } });
    if (!credential) return forbidden("Digital/passkey não reconhecida para esta conta.");
    const { rpID, origin } = getWebAuthnConfig(req);
    try {
      const result = await verifyAuthenticationResponse({
        response: parsed.data.verification.response as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
        expectedChallenge: account.webAuthnChallenge!,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        authenticator: {
          credentialID: Buffer.from(credential.id, "base64url"),
          credentialPublicKey: new Uint8Array(credential.publicKey),
          counter: Number(credential.counter),
          transports: credential.transports as AuthenticatorTransport[],
        },
      });
      if (!result.verified || !result.authenticationInfo.userVerified) return forbidden("A identidade não foi confirmada pelo aparelho.");
      await prisma.$transaction([
        prisma.passkeyCredential.update({ where: { id: credential.id }, data: { counter: BigInt(result.authenticationInfo.newCounter), lastUsedAt: now } }),
        prisma.user.update({ where: { id: user.id }, data: { webAuthnChallenge: null, webAuthnChallengePurpose: null, webAuthnChallengeExpiresAt: null } }),
      ]);
      authenticationMethod = "PASSKEY";
    } catch {
      return forbidden("A confirmação por digital/passkey falhou. Tente novamente ou use sua senha.");
    }
  }

  try {
    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.timeClockEntry.create({
        data: {
          userId: user.id,
          eventType,
          workDate,
          occurredAt: now,
          locationStatus: location.status,
          latitude: granted ? location.latitude ?? null : null,
          longitude: granted ? location.longitude ?? null : null,
          accuracyMeters: granted ? location.accuracyMeters ?? null : null,
          locationCapturedAt: granted
            ? location.capturedAt
              ? new Date(location.capturedAt)
              : now
            : null,
          userAgentSummary: location.userAgentSummary ?? null,
          deviceType: location.deviceType ?? null,
        },
        select: entrySelect,
      });

      if (requiresEarlyDeparture && earlyDeparture) {
        await tx.timeClockEarlyDeparture.create({
          data: {
            entryId: created.id,
            userId: user.id,
            expectedAt: getExpectedClockOutAt(workDate),
            actualAt: now,
            reason: earlyDeparture.reason,
            description: earlyDeparture.description,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "TIME_CLOCK_RECORDED",
          entityType: "TimeClockEntry",
          entityId: created.id,
          metadata: {
            eventType,
            workDate: workDate.toISOString().slice(0, 10),
            locationStatus: location.status,
            authenticationMethod,
            earlyDeparture: requiresEarlyDeparture && earlyDeparture
              ? { reason: earlyDeparture.reason }
              : undefined,
          },
          ipAddress,
          userAgent: req.headers.get("user-agent"),
        },
      });

      return created;
    });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "Este tipo de ponto já foi registrado hoje." },
        { status: 409 }
      );
    }
    throw error;
  }
}
