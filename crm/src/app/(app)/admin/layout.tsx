import { redirect } from "next/navigation";
import { auth } from "@/auth";

// Segunda camada de RBAC (a primeira é o middleware): mesmo que alguém
// contorne o middleware, esta checagem no server component bloqueia o
// acesso de novo antes de renderizar qualquer dado administrativo.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/dashboard");
  }
  return <>{children}</>;
}
