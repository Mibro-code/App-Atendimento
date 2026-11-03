// Only an enabled fixed-owner link retains the sector between service cycles.
// A recorded manual removal/transfer always takes precedence over older history.
async function retainedCategory(db, { contact, conversation }) {
  if (!contact?.preferredAssigneeEnabled || !contact.preferredAssigneeId
    || contact.companyId !== conversation.companyId || conversation.channel !== "META") return null;
  if (conversation.categoryId) return conversation.categoryId;
  const last = await db.conversationActivity.findFirst({
    where: {
      conversation: { is: { contactId: contact.id, companyId: conversation.companyId, channel: "META" } },
      action: { in: ["CATEGORY_CHANGED", "INBOUND_CATEGORY_ASSIGNED"] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { action: true, details: true },
  });
  const id = last?.action === "CATEGORY_CHANGED" ? last.details?.toCategoryId
    : last?.details?.categoryId;
  if (typeof id !== "string" || !id) return null;
  const category = await db.category.findFirst({ where: { id, companyId: conversation.companyId, active: true }, select: { id: true } });
  return category?.id || null;
}

module.exports = { retainedCategory };
