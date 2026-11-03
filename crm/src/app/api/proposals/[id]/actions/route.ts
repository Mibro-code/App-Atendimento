import { NextRequest, NextResponse } from "next/server";
import { fieldErrorsFromZod, requireSession, validationFailed } from "@/lib/api-auth";
import { proposalErrorResponse } from "@/lib/proposals/proposal-api";
import { actionSchema } from "@/lib/proposals/proposal-schemas";
import * as service from "@/lib/proposals/proposal-service";
import { approveExistingOrder } from "@/lib/proposals/proposal-operations";

/**
 * Ações do fluxo da proposta. Cada função do serviço refaz a autorização
 * (cargo, equipe, empresa, estado e versão) a partir do banco antes de
 * gravar ou chamar o Olist.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSession();
  if (error) return error;
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationFailed(fieldErrorsFromZod(parsed.error));
  const id = (await params).id;
  const input = parsed.data;
  try {
    switch (input.action) {
      case "sync":
        return NextResponse.json(await service.syncProposal(user, id));
      case "resolve_conflict":
        return NextResponse.json(await service.syncProposal(user, id, true));
      case "refresh":
        return NextResponse.json(await service.refreshFromOlist(user, id));
      case "submit":
        await service.submitForApproval(user, id, input.justification ?? null);
        break;
      case "approve":
        await service.decideApproval(user, id, "approve", input.reason ?? null);
        break;
      case "reject":
      case "request_changes":
        await service.decideApproval(user, id, input.action, input.reason);
        break;
      case "send_email":
        return NextResponse.json(await service.sendProposalEmail(user, id, input.to ?? null));
      case "register_dispatch":
        await service.registerDispatch(user, id, { description: input.description, recipient: input.recipient ?? null });
        break;
      case "register_response":
        await service.registerCustomerResponse(user, id, {
          decision: input.decision, channel: input.channel, evidence: input.evidence,
          contactName: input.contactName ?? null, occurredAt: new Date(input.occurredAt),
        });
        break;
      case "reopen":
        await service.reopenNegotiation(user, id, input.reason);
        break;
      case "request_conversion":
        await service.requestConversion(user, id);
        break;
      case "deny_conversion":
        await service.denyConversion(user, id, input.reason);
        break;
      case "convert":
        return NextResponse.json(await service.convertToOrder(user, id));
      case "reconcile_order":
        return NextResponse.json(await service.reconcileWithOrder(user, id, input.orderNumber, input.justification));
      case "refresh_order":
        return NextResponse.json(await service.refreshOrderStatus(user, id));
      case "approve_order":
        return NextResponse.json(await approveExistingOrder(user, id));
      case "transfer":
        return NextResponse.json(await service.transferProposal(user, id, input.sellerId, input.reason));
      case "cancel":
        await service.cancelProposal(user, id, input.reason);
        break;
      case "duplicate":
        return NextResponse.json(await service.duplicateProposal(user, id), { status: 201 });
      case "finance_review":
        await service.financeReview(user, id, input.note);
        break;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return proposalErrorResponse(e);
  }
}
