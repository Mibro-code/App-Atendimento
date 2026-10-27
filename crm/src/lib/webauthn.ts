import "server-only";
import type { NextRequest } from "next/server";

export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function getWebAuthnConfig(req: NextRequest) {
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.headers.get("host") || new URL(req.url).host;
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || new URL(req.url).protocol.replace(":", "");
  const rpID = process.env.WEBAUTHN_RP_ID || host.split(":")[0];
  const origin = process.env.WEBAUTHN_ORIGIN || `${protocol}://${host}`;
  return { rpID, origin, rpName: process.env.WEBAUTHN_RP_NAME || "CRM Comercial" };
}

export function challengeExpiresAt() {
  return new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS);
}

export function validChallenge(user: {
  webAuthnChallenge: string | null;
  webAuthnChallengePurpose: string | null;
  webAuthnChallengeExpiresAt: Date | null;
}, purpose: string) {
  return !!user.webAuthnChallenge && user.webAuthnChallengePurpose === purpose &&
    !!user.webAuthnChallengeExpiresAt && user.webAuthnChallengeExpiresAt.getTime() > Date.now();
}
