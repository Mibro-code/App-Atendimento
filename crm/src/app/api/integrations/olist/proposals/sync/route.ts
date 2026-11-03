import { NextRequest, NextResponse } from "next/server";
import { requireSharedSecret } from "@/lib/api-auth";
import { proposalsEnabled } from "@/lib/proposals/proposal-config";
import { runProposalSyncBatch } from "@/lib/proposals/proposal-sync-job";

/**
 * Sincronização periódica das propostas/pedidos com o Olist (somente
 * leitura). Chamada por agendador do servidor com Bearer
 * CRM_PROPOSAL_SYNC_SECRET; nunca pelo navegador.
 */
export async function POST(req: NextRequest) {
  const auth = requireSharedSecret(req, "CRM_PROPOSAL_SYNC_SECRET");
  if (!auth.ok) return auth.error;
  if (!proposalsEnabled()) return NextResponse.json({ success: false, code: "FEATURE_DISABLED" }, { status: 404 });
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 20);
  const result = await runProposalSyncBatch(Number.isFinite(limit) ? limit : 20);
  return NextResponse.json({ success: result.failed === 0, ...result }, { status: result.failed === 0 ? 200 : 207 });
}
