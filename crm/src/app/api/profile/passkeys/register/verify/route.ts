import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { requireSession, badRequest } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { getWebAuthnConfig, validChallenge } from "@/lib/webauthn";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { webAuthnChallenge: true, webAuthnChallengePurpose: true, webAuthnChallengeExpiresAt: true },
  });
  if (!account || !validChallenge(account, "REGISTER")) return badRequest("A solicitação de cadastro expirou. Tente novamente.");

  const response = await req.json().catch(() => null);
  if (!response) return badRequest("Resposta da digital/passkey inválida.");
  const { rpID, origin } = getWebAuthnConfig(req);

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: account.webAuthnChallenge!,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) return badRequest("Não foi possível confirmar a digital/passkey.");
    const info = verification.registrationInfo;
    const credentialId = Buffer.from(info.credentialID).toString("base64url");

    await prisma.$transaction([
      prisma.passkeyCredential.create({
        data: {
          id: credentialId,
          userId: user.id,
          publicKey: Buffer.from(info.credentialPublicKey),
          counter: BigInt(info.counter),
          transports: Array.isArray(response.response?.transports) ? response.response.transports : [],
          deviceType: info.credentialDeviceType,
          backedUp: info.credentialBackedUp,
        },
      }),
      prisma.user.update({ where: { id: user.id }, data: { webAuthnChallenge: null, webAuthnChallengePurpose: null, webAuthnChallengeExpiresAt: null } }),
      prisma.auditLog.create({ data: { actorId: user.id, action: "PASSKEY_REGISTERED", entityType: "User", entityId: user.id, metadata: { deviceType: info.credentialDeviceType } } }),
    ]);
    return NextResponse.json({ success: true });
  } catch {
    return badRequest("A verificação da digital/passkey falhou.");
  }
}
