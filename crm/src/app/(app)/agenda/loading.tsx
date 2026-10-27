import { AgendaSkeleton } from "@/components/agenda/agenda-ui";

export default function AgendaLoading() {
  return (
    <div className="space-y-4">
      <div className="h-7 w-28 animate-pulse rounded bg-gray-100" />
      <div className="h-10 w-full max-w-md animate-pulse rounded-lg bg-gray-100" />
      <AgendaSkeleton rows={5} />
    </div>
  );
}
