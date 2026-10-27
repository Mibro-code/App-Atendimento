import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { TimeClockTeamView } from "@/components/time-clock-team-view";

export default async function EquipePontoPage() {
  const session = await auth();
  if (session!.user.role !== "SUPERVISOR") redirect("/dashboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Jornada da equipe</h1>
        <p className="text-sm text-gray-500 mt-1">
          Ponto, localização e ocorrências dos vendedores da sua equipe.
        </p>
      </div>
      <TimeClockTeamView
        apiBase="/api/team/time-clock"
        occurrenceApiBase="/api/team/time-clock/occurrences"
        correctionApiBase="/api/team/time-clock/entries"
        canCorrectEntries
      />
    </div>
  );
}
