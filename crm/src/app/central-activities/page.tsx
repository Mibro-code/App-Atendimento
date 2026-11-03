import { ActivityCenter } from "@/components/activity-center";
import { activityCenterPageProps } from "@/lib/activity-center-page";

// Versão compacta aberta dentro da Central (sem AppShell). A API autentica e
// aplica o escopo dos dois sistemas de forma independente.
export default async function CentralActivitiesPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company } = await searchParams;
  return <ActivityCenter embedded {...await activityCenterPageProps(company)} />;
}
