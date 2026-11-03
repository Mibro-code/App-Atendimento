// Mostrado imediatamente ao trocar de seção enquanto o servidor monta a
// página — antes não havia nenhum retorno visual durante a navegação.
export default function AppLoading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Carregando">
      <div className="h-6 w-48 rounded bg-gray-200" />
      <div className="h-4 w-72 rounded bg-gray-100" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => <div key={index} className="card h-24 bg-gray-100" />)}
      </div>
    </div>
  );
}
