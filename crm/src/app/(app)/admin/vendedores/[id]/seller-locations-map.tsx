"use client";

import dynamic from "next/dynamic";
import type { MapPoint } from "../../mapa/types";

// Reaproveita o mesmo MapView do mapa comercial (item 14 do plano de
// localização da proposta) — sem duplicar a renderização Leaflet. Aqui NÃO
// existe posição "atual" do vendedor: só o histórico de locais onde ele
// registrou visitas/propostas (nunca rastreamento em tempo real).
const MapView = dynamic(() => import("../../mapa/map-view"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-sm text-gray-400">Carregando mapa...</div>
  ),
});

export function SellerLocationsMap({ points }: { points: MapPoint[] }) {
  return <MapView points={points} />;
}
