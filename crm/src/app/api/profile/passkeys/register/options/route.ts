import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { requireSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { challengeExpiresAt, getWebAuthnConfig } from "@/lib/webauthn";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  const account = await prisma.user.findFirst({
    where: { id: user.id, active: true, deletedAt: null },
    select: { id: true, name: true, email: true, passkeys: { select: { id: true, transports: true } } },
  });
  if (!account) return NextResponse.json({ error: "Conta indisponível." }, { status: 403 });

  const { rpID, rpName } = getWebAuthnConfig(req);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: account.id,
    userName: account.email,
    userDisplayName: account.name,
    attestationType: "none",
    timeout: 60000,
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    excludeCredentials: account.passkeys.map((credential) => ({
      id: Buffer.from(credential.id, "base64url"),
      type: "public-key" as const,
      transports: credential.transports as AuthenticatorTransport[],
    })),
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { webAuthnChallenge: options.challenge, webAuthnChallengePurpose: "REGISTER", webAuthnChallengeExpiresAt: challengeExpiresAt() },
  });
  return NextResponse.json(options);
}
