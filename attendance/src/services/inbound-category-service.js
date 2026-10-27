// Opt-in per receiving number. Never reclassify an assigned or categorized chat.
async function applyInboundCategory(db, { account, conversationId }) {
  const categoryId = account?.config?.inboundCategoryId;
  if (account?.channel !== "META" || !account.enabled || !account.companyId
      || typeof categoryId !== "string" || !categoryId.trim()) return false;
  const allowed = account.config.allowedCategoryIds || [];
  if (allowed.length && !allowed.includes(categoryId)) return false;
  const category = await db.category.findFirst({
    where: { id: categoryId, companyId: account.companyId, active: true, masterOnly: false },
    select: { id: true },
  });
  if (!category) return false;
  const changed = await db.conversation.updateMany({
    where: {
      id: conversationId, companyId: account.companyId, channel: "META",
      channelAccountId: account.id, categoryId: null, assignedUserId: null,
      status: { in: ["NOVO", "BOT"] },
    },
    data: { categoryId: category.id },
  });
  if (!changed.count) return false;
  await db.conversationActivity.create({ data: {
    conversationId, action: "INBOUND_CATEGORY_ASSIGNED",
    details: { categoryId: category.id, channelAccountId: account.id },
  } });
  return true;
}

module.exports = { applyInboundCategory };
