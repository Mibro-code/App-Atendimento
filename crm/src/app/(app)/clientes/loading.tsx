export default function ClientesLoading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Carregando clientes">
      <div className="h-6 w-40 rounded bg-gray-200" />
      <div className="h-10 w-full rounded bg-gray-100" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="h-96 w-[18.5rem] shrink-0 rounded-xl bg-gray-100" />
        ))}
      </div>
    </div>
  );
}
