import "server-only";
import { prisma } from "@/lib/prisma";
import { notifyOnce } from "@/lib/notifications";
import { quoteAlertDedupeKey, quoteAlertText } from "@/lib/quotes/quote-alert-rules";

/**
 * Avisa o supervisor do vendedor responsável que uma cotação foi feita.
 * Idempotente (uma vez por proposta). Não avisa quando o próprio supervisor
 * fez a cotação, nem quando o vendedor não tem supervisor ativo.
 * Nunca deve derrubar o fluxo principal: erros são apenas registrados.
 */
export async function notifySupervisorOfQuote(quoteId: string, actorId: string | null): Promise<void> {
  try {
    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      select: {
        id: true, brand: true, mode: true, origin: true, priceGroup: true, selectedTier: true, totalValueCents: true, deletedAt: true,
        customer: { select: { contactName: true, tradeName: true } },
        seller: {
          select: {
            name: true,
            sellerProfile: { select: { displayName: true } },
            supervisor: { select: { id: true, active: true, deletedAt: true, role: true } },
          },
        },
      },
    });
    const supervisor = quote?.seller.supervisor;
    if (!quote || quote.deletedAt || !supervisor || !supervisor.active || supervisor.deletedAt) return;
    if (supervisor.id === actorId) return;

    const { title, message } = quoteAlertText({
      sellerName: quote.seller.sellerProfile?.displayName ?? quote.seller.name,
      customerName: quote.customer.tradeName || quote.customer.contactName,
      brand: quote.brand,
      mode: quote.mode,
      origin: quote.origin,
      totalValueCents: quote.totalValueCents,
      priceGroup: quote.priceGroup,
      selectedTier: quote.selectedTier,
    });
    await notifyOnce({
      recipientId: supervisor.id,
      type: "QUOTE_CREATED",
      title,
      message,
      quoteId: quote.id,
      dedupeKey: quoteAlertDedupeKey(quote.id),
    });
  } catch (error) {
    console.error("QUOTE_SUPERVISOR_ALERT_FAILED", { quoteId, error });
  }
}
