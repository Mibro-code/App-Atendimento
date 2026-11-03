import { redirect } from "next/navigation";

// O funil vive na própria tela de Clientes (sem tela duplicada). Mantido
// apenas como redirecionamento para links antigos.
export default async function CustomerPipelinePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  redirect(q ? `/clientes?q=${encodeURIComponent(q)}` : "/clientes");
}
