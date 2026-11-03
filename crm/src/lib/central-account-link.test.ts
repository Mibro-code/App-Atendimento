import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ request: vi.fn(), transaction: vi.fn(), enabled: vi.fn() }));
vi.mock('./prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('./central-identity', () => ({ centralRequest: mocks.request, centralEnabled: mocks.enabled }));
import { linkCentralAccount } from './central-account-link';
const account = { id: 'c', email: 'person@example.invalid', active: true, deletedAt: null, role: 'VENDEDOR' };
const plan = { status: 'PENDING', attendanceUserId: 'a', primaryEmail: account.email, crmUserId: 'c', confirmation: 'PENDING:fixture' };
const tx = { user: { findUnique: vi.fn(), findFirst: vi.fn() }, centralIdentityLink: { findUnique: vi.fn(), upsert: vi.fn() }, auditLog: { create: vi.fn() } };
beforeEach(() => {
  vi.resetAllMocks(); mocks.enabled.mockReturnValue(true); mocks.transaction.mockImplementation(fn => fn(tx));
  tx.user.findUnique.mockResolvedValue(account); tx.user.findFirst.mockResolvedValue(null); tx.centralIdentityLink.findUnique.mockResolvedValue(null);
  mocks.request.mockResolvedValueOnce(plan).mockResolvedValue({ status: 'LINKED' });
});
it('automatically matches via server and confirms only after CRM transaction', async () => {
  expect(await linkCentralAccount(account)).toEqual({ status: 'LINKED' });
  expect(mocks.request.mock.calls[0]).toEqual(['/identity/access-reserve', expect.objectContaining({ crmEmail: account.email, manual: false })]);
  expect(mocks.request.mock.calls[1]).toEqual(['/identity/access-commit', plan]);
  expect(tx.centralIdentityLink.upsert).toHaveBeenCalledOnce();
  expect(tx.centralIdentityLink.upsert.mock.calls[0][0].update).not.toHaveProperty('passwordHash');
});
it('does not contact Attendance for representatives or disabled bridge', async () => {
  expect(await linkCentralAccount({ ...account, role: 'REPRESENTANTE' })).toEqual({ status: 'NOT_APPLICABLE' });
  mocks.enabled.mockReturnValue(false); await linkCentralAccount(account); expect(mocks.request).not.toHaveBeenCalled();
});
it.each(['NO_MATCH', 'DISABLED'])('preserves %s instead of creating a mirror', async status => {
  mocks.request.mockReset().mockResolvedValue({ status }); expect(await linkCentralAccount(account)).toEqual({ status }); expect(mocks.transaction).not.toHaveBeenCalled();
});
it('inactive CRM account cannot reserve a link', async () => {
  await expect(linkCentralAccount({ ...account, active: false })).rejects.toThrow(); expect(mocks.request).not.toHaveBeenCalled();
});
it('mismatched remote account id blocks mirror and commit', async () => {
  mocks.request.mockReset().mockResolvedValue({ ...plan, crmUserId: 'other' }); await expect(linkCentralAccount(account)).rejects.toThrow(); expect(mocks.transaction).not.toHaveBeenCalled();
});
it('existing different link is never overwritten', async () => {
  tx.centralIdentityLink.findUnique.mockResolvedValue({ attendanceUserId: 'other' });
  await expect(linkCentralAccount(account)).rejects.toThrow(); expect(tx.centralIdentityLink.upsert).not.toHaveBeenCalled(); expect(mocks.request).toHaveBeenCalledTimes(1);
});
it('login-email collision blocks mirror and commit', async () => {
  tx.user.findFirst.mockResolvedValue({ id: 'other' }); await expect(linkCentralAccount(account)).rejects.toThrow(); expect(tx.centralIdentityLink.upsert).not.toHaveBeenCalled(); expect(mocks.request).toHaveBeenCalledTimes(1);
});
it('CRM transaction failure never activates Attendance', async () => {
  mocks.transaction.mockRejectedValue(Error('database unavailable')); await expect(linkCentralAccount(account)).rejects.toThrow(); expect(mocks.request).toHaveBeenCalledTimes(1);
});
it('timeout at final confirmation is not reported as success', async () => {
  mocks.request.mockReset().mockResolvedValueOnce(plan).mockRejectedValue(Error('timeout'));
  await expect(linkCentralAccount(account)).rejects.toThrow(); expect(tx.centralIdentityLink.upsert).toHaveBeenCalledOnce();
});
