import { prisma } from './prisma';
import { centralEnabled, centralRequest } from './central-identity';

type Plan = { status: string; attendanceUserId?: string; crmUserId?: string; primaryEmail?: string; confirmation?: string };
type Account = { id: string; email: string; role: string; active: boolean; deletedAt: Date | null };

export async function linkCentralAccount(account: Account, attendanceUserId?: string) {
  if (!centralEnabled() || account.role === 'REPRESENTANTE') return { status: 'NOT_APPLICABLE' };
  if (!account.active || account.deletedAt) throw Error('Conta CRM inativa.');
  const plan = await centralRequest<Plan>('/identity/access-reserve', {
    crmUserId: account.id, crmEmail: account.email, crmRole: account.role,
    manual: Boolean(attendanceUserId), attendanceUserId,
  });
  if (!['PENDING', 'LINKED'].includes(plan.status)) return { status: plan.status };
  if (!plan.attendanceUserId || !plan.primaryEmail || plan.crmUserId !== account.id) throw Error('Vínculo inválido.');
  // A failed remote commit leaves Attendance disabled, never partly authorized.
  await prisma.$transaction(async tx => {
    const current = await tx.user.findUnique({ where: { id: account.id } });
    if (!current?.active || current.deletedAt || current.role === 'REPRESENTANTE' || current.email !== account.email) throw Error('Conta CRM alterada.');
    const existing = await tx.centralIdentityLink.findUnique({ where: { userId: account.id } });
    if (existing && existing.attendanceUserId !== plan.attendanceUserId) throw Error('Conta já vinculada a outra pessoa.');
    // Do not shadow an unrelated user's original login address.
    const collision = await tx.user.findFirst({ where: { id: { not: account.id }, email: { equals: plan.primaryEmail, mode: 'insensitive' } }, select: { id: true } });
    if (collision) throw Error('E-mail principal já pertence a outra conta CRM.');
    const data = { attendanceUserId: plan.attendanceUserId!, primaryEmail: plan.primaryEmail!, enabled: true, confirmation: 'EMAIL_CONFIRMED' };
    await tx.centralIdentityLink.upsert({ where: { userId: account.id }, create: { userId: account.id, ...data }, update: data });
    await tx.auditLog.create({ data: { action: 'USER_PERMISSIONS_UPDATED', entityType: 'User', entityId: account.id,
      metadata: { source: 'CENTRAL_ACCOUNT_LINK', attendanceUserId: plan.attendanceUserId! } } });
  });
  if (plan.status === 'PENDING') await centralRequest('/identity/access-commit', plan);
  return { status: 'LINKED' };
}
