import { MapaClient } from "./mapa-client";

// RBAC: esta rota já herda a proteção do AdminLayout (server component que
// redireciona quem não é ADMIN antes de renderizar qualquer coisa) e a API
// que alimenta os dados (/api/admin/location-captures) checa ADMIN de novo,
// de forma independente — nunca confiamos só em esconder o link no menu.
export default function AdminMapaPage() {
  return <MapaClient />;
}
