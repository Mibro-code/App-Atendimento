import { TimeClockTeamView } from "@/components/time-clock-team-view";

// Guarda de "/admin/*" já aplicada no middleware (redireciona não-ADMIN antes
// de chegar aqui) — mesmo padrão das demais páginas de src/app/(app)/admin.
export default function AdminPontoPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Ponto — todas as equipes</h1>
        <p className="text-sm text-gray-500 mt-1">
          Visão completa de jornada, localização e ocorrências de todos os vendedores e supervisores.
        </p>
      </div>
      <TimeClockTeamView
        apiBase="/api/admin/time-clock"
        occurrenceApiBase="/api/admin/time-clock/occurrences"
        showSupervisorFilter
        canCorrectEntries
      />
    </div>
  );
}
