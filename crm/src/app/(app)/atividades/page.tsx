import { ActivityCenter } from "@/components/activity-center";
import { activityCenterPageProps } from "@/lib/activity-center-page";

export default async function ActivitiesPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company } = await searchParams;
  return <ActivityCenter embedded={false} {...await activityCenterPageProps(company)} />;
}
