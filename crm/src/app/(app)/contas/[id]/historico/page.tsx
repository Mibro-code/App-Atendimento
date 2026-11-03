import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/format";

const ACTION_LABELS: Record<string, string> = {
  USER_CREATED: "Conta criada",
  USER_UPDATED: "Dados de acesso alterados",
  USER_PERMISSIONS_UPDATED: "Permissões alteradas",
  USER_PASSWORD_RESET: "Senha redefinida pelo administrador",
  USER_PASSWORD_CHANGED: "Senha alterada pelo usuário",
  USER_DEACTIVATED: "Conta desativada",
  USER_REACTIVATED: "Conta reativada",
  USER_DELETED: "Conta excluída",
  SELLER_PROFILE_UPDATED: "Perfil comercial alterado",
  TEAM_SETTINGS_UPDATED: "Configurações da equipe alteradas",
  PASSKEY_REGISTERED: "Digital/passkey cadastrada",
  LOGIN_SUCCESS: "Acesso realizado",
};

const FIELD_LABELS: Record<string, string> = {
  role: "Papel",
  supervisorId: "Supervisor",
  active: "Status ativo",
  followUpAfterDays: "Dias para follow-up",
  allowSellerCustomerTransfer: "Repasse geral da equipe",
  canTransferOwnCustomers: "Pode repassar clientes próprios",
  canCreateTeamUsers: "Pode criar integrantes",
  name: "Nome",
};

function readableMetadata(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const metadata = value as Record<string, unknown>;
  const changes = metadata.changes;
  if (changes && typeof changes === "object" && !Array.isArray(changes)) {
    return Object.entries(changes as Record<string, { from?: unknown; to?: unknown }>).map(([field, change]) =>
      `${FIELD_LABELS[field] || field}: ${String(change?.from ?? "—")} → ${String(change?.to ?? "—")}`
    );
  }
  if (Array.isArray(metadata.fields)) return [`Campos: ${metadata.fields.map((field) => FIELD_LABELS[String(field)] || String(field)).join(", ")}`];
  return Object.entries(metadata)
    .filter(([key]) => !["email", "name"].includes(key))
    .slice(0, 6)
    .map(([key, item]) => `${FIELD_LABELS[key] || key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`);
}

export default async function AccountHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !["ADMIN", "SUPERVISOR"].includes(session.user.role)) redirect("/dashboard");
  const { id } = await params;

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, active: true, deletedAt: true, supervisorId: true },
  });
  if (!target) notFound();
  if (session.user.role === "SUPERVISOR" && target.id !== session.user.id && target.supervisorId !== session.user.id) redirect("/equipe");

  const entries = await prisma.auditLog.findMany({
    where: { entityId: id, entityType: { in: ["User", "SellerProfile"] } },
    select: { id: true, action: true, metadata: true, createdAt: true, actor: { select: { name: true, role: true } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  return <div className="max-w-3xl space-y-6">
    <div>
      <h1 className="text-xl font-semibold text-gray-900">Histórico da conta</h1>
      <p className="mt-1 text-sm text-gray-500">{target.name} · {target.email}</p>
      <p className="mt-2 text-xs text-gray-500">Status: {target.deletedAt ? "Excluída" : target.active ? "Ativa" : "Desativada"}</p>
    </div>
    <div className="card overflow-hidden">
      {entries.length === 0 ? <p className="p-6 text-sm text-gray-500">Nenhuma alteração registrada.</p> : <ol className="divide-y divide-gray-100">
        {entries.map((entry) => {
          const details = readableMetadata(entry.metadata);
          return <li key={entry.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-gray-900">{ACTION_LABELS[entry.action] || entry.action}</p>
                <p className="mt-1 text-xs text-gray-500">Por {entry.actor?.name || "Sistema"}{entry.actor?.role ? ` (${entry.actor.role})` : ""}</p>
              </div>
              <time className="text-xs text-gray-500">{formatDateTime(entry.createdAt)}</time>
            </div>
            {details.length > 0 && <ul className="mt-3 space-y-1 text-xs text-gray-600">{details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}
          </li>;
        })}
      </ol>}
    </div>
  </div>;
}
