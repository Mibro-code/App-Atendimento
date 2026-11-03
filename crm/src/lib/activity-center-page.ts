import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { centralEnabled, identityOrigins } from "@/lib/central-identity";

/** Dados de página comuns às duas entradas da Central de Atividades. */
export async function activityCenterPageProps(company?: string) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const account = await prisma.user.findFirst({
    where: { id: session.user.id, active: true, deletedAt: null },
    select: { role: true, ...(centralEnabled() ? { centralIdentityLink: { select: { enabled: true } } } : {}) },
  });
  if (!account) redirect("/login?error=account-disabled");
  // Representantes e contas sem vínculo continuam vendo somente o CRM.
  const linked = centralEnabled() && account.role !== "REPRESENTANTE" && !!account.centralIdentityLink?.enabled;
  return {
    initialCompany: company === "mibro" || company === "sincrofit" ? company : "",
    canViewTeam: account.role === "SUPERVISOR" || account.role === "ADMIN",
    attendanceOrigin: linked ? identityOrigins().attendance : undefined,
  };
}
