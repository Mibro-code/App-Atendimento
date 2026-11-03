import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { timeClockEventValues } from "@/lib/time-clock";
import { challengeExpiresAt, getWebAuthnConfig } from "@/lib/webauthn";

export const runtime = "nodejs";
const schema = z.object({ eventType: z.enum(timeClockEventValues) });

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Tipo de ponto inválido.");
  const credentials = await prisma.passkeyCredential.findMany({ where: { userId: user.id }, select: { id: true, transports: true } });
  if (credentials.length === 0) return NextResponse.json({ error: "Nenhuma digital/passkey cadastrada.", code: "PASSKEY_NOT_REGISTERED" }, { status: 409 });

  const { rpID } = getWebAuthnConfig(req);
  const options = await generateAuthenticationOptions({
    rpID,
    timeout: 60000,
    userVerification: "required",
    allowCredentials: credentials.map((credential) => ({ id: Buffer.from(credential.id, "base64url"), type: "public-key" as const, transports: credential.transports as AuthenticatorTransport[] })),
  });
  await prisma.user.update({
    where: { id: user.id },
    data: {
      webAuthnChallenge: options.challenge,
      webAuthnChallengePurpose: `TIME_CLOCK:${parsed.data.eventType}`,
      webAuthnChallengeExpiresAt: challengeExpiresAt(),
    },
  });
  return NextResponse.json(options);
}
