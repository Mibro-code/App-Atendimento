import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { legacyDirectOrderPolicy, proposalConversionMode, proposalsEnabled, proposalSituationSyncEnabled } from "@/lib/proposals/proposal-config";
import { ProposalAdmin } from "./proposal-admin";

export default async function ProposalAdminPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/dashboard");
  const enabled = proposalsEnabled();
  const [users, links, limits] = enabled
    ? await Promise.all([
        prisma.user.findMany({
          where: { deletedAt: null, active: true },
          select: { id: true, name: true, role: true, commercialFunctions: true, supervisor: { select: { name: true } } },
          orderBy: { name: "asc" },
        }),
        prisma.sellerOlistLink.findMany({ select: { userId: true, brand: true, olistSellerId: true, olistSellerName: true, active: true, updatedAt: true } }),
        prisma.proposalDiscountLimit.findMany({ where: { active: true }, select: { scopeKey: true, brandKey: true, maxDiscountBps: true } }),
      ])
    : [[], [], []];

  return (
    <div className="max-w-6xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Propostas comerciais — configuração</h1>
        <p className="text-sm text-gray-500">Vínculo de vendedores com o Olist, funções comerciais e alçadas de desconto.</p>
      </div>
      <section className="card p-4 text-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Situação do módulo (variáveis do servidor)</h2>
        <ul className="grid grid-cols-1 gap-1 text-xs text-gray-600 sm:grid-cols-2">
          <li>CRM_PROPOSALS_OLIST_ENABLED: <strong>{enabled ? "ativo" : "desativado"}</strong></li>
          <li>OLIST_PROPOSAL_CONVERSION_MODE: <strong>{proposalConversionMode()}</strong></li>
          <li>OLIST_PROPOSAL_SITUATION_SYNC: <strong>{proposalSituationSyncEnabled() ? "ligado" : "desligado"}</strong></li>
          <li>CRM_LEGACY_DIRECT_ORDER (pedido direto antigo): <strong>{legacyDirectOrderPolicy()}</strong></li>
        </ul>
      </section>
      {enabled ? (
        <ProposalAdmin
          users={users.map((u) => ({ id: u.id, name: u.name, role: u.role, functions: u.commercialFunctions, supervisor: u.supervisor?.name ?? null }))}
          links={links.map((l) => ({ ...l, updatedAt: l.updatedAt.toISOString() }))}
          limits={limits}
        />
      ) : (
        <p className="card p-4 text-sm text-gray-600">Ative o módulo no servidor para configurar vínculos e alçadas.</p>
      )}
    </div>
  );
}
