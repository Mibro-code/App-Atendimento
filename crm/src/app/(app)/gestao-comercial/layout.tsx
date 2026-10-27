import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canViewPriceTables } from "@/lib/pricing/price-admin-rules";

// Gestão Comercial: admin edita, supervisor consulta. As rotas de API
// reconferem a permissão a cada chamada — esta guarda só evita renderizar.
export default async function GestaoComercialLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || !canViewPriceTables(session.user.role)) {
    redirect("/dashboard");
  }
  return <>{children}</>;
}
