import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getTeamMemberCustomers } from "@/lib/supervisor-analytics";
import { TeamMemberDashboard } from "./team-member-dashboard";

export default async function TeamMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const actor = { id: session!.user.id, role: session!.user.role };
  if (actor.role !== "SUPERVISOR" && actor.role !== "ADMIN") redirect("/dashboard");
  const { id } = await params;
  if (!(await getTeamMemberCustomers(actor, id))) notFound();
  return <TeamMemberDashboard memberId={id} />;
}
