"use client";

import dynamic from "next/dynamic";

// Leaflet acessa `window`/`document` no import — precisa ser carregado só no
// client (mesmo padrão de admin/mapa/mapa-client.tsx).
export const TimeClockLocationMapDynamic = dynamic(() => import("./time-clock-location-map"), {
  ssr: false,
  loading: () => <div className="h-[220px] flex items-center justify-center text-xs text-gray-400">Carregando mapa...</div>,
});
