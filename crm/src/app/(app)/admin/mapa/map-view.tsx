"use client";

import { useEffect } from "react";
import Link from "next/link";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { formatCentsToBRL, formatDateTime } from "@/lib/format";
import { QUOTE_STATUS_LABELS, PROPOSAL_MODE_LABELS } from "@/lib/labels";
import type { MapPoint } from "./types";

const LOCATION_SOURCE_LABELS: Record<string, string> = {
  CUSTOMER_VISIT: "Visita presencial",
  PROPOSAL_STARTED: "Início de proposta",
  PROPOSAL_SENT: "Envio de proposta",
};
import markerIcon2xAsset from "leaflet/dist/images/marker-icon-2x.png";
import markerIconAsset from "leaflet/dist/images/marker-icon.png";
import markerShadowAsset from "leaflet/dist/images/marker-shadow.png";

// Corrige os caminhos dos ícones padrão do Leaflet no bundle do Next.js
// (por padrão ele tenta resolver via URL relativa e quebra em produção).
// Servidos a partir dos assets locais empacotados pelo Next — sem depender
// de nenhum CDN externo.
const markerIcon2x = markerIcon2xAsset.src;
const markerIcon = markerIconAsset.src;
const markerShadow = markerShadowAsset.src;

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const BRAND_ICON = new L.Icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    const withCoords = points.filter((p) => p.latitude != null && p.longitude != null);
    if (withCoords.length === 0) return;
    const bounds = L.latLngBounds(withCoords.map((p) => [p.latitude as number, p.longitude as number]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [points, map]);
  return null;
}

export default function MapView({ points }: { points: MapPoint[] }) {
  const withCoords = points.filter((p) => p.latitude != null && p.longitude != null);
  // Centro padrão: Brasil, caso ainda não haja nenhum ponto no filtro atual.
  const defaultCenter: [number, number] = [-14.235, -51.9253];

  return (
    <MapContainer
      center={defaultCenter}
      zoom={4}
      scrollWheelZoom
      style={{ height: "100%", width: "100%", borderRadius: "0.5rem" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> colaboradores'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={withCoords} />
      <MarkerClusterGroup chunkedLoading>
        {withCoords.map((p) => (
          <Marker key={p.id} position={[p.latitude as number, p.longitude as number]} icon={BRAND_ICON}>
            <Popup>
              <div className="space-y-1 text-sm">
                <p className="font-semibold text-gray-900">
                  {p.customer.id ? (
                    <Link href={`/clientes/${p.customer.id}`} className="text-brand hover:underline">
                      {p.customer.name}
                    </Link>
                  ) : (
                    p.customer.name
                  )}
                </p>
                <p className="text-gray-600">
                  Vendedor:{" "}
                  <Link href={`/admin/vendedores/${p.seller.id}`} className="text-brand hover:underline">
                    {p.seller.name}
                  </Link>
                </p>
                <p className="text-gray-600">Data/hora: {formatDateTime(p.capturedAt)}</p>
                <p className="text-gray-600">
                  Tipo: {LOCATION_SOURCE_LABELS[p.locationSource] ?? p.locationSource}
                </p>
                {p.quote && (
                  <>
                    <p className="text-gray-600">
                      Proposta:{" "}
                      <Link href={`/cotacoes/${p.quote.id}`} className="text-brand hover:underline">
                        {PROPOSAL_MODE_LABELS[p.quote.mode] ?? p.quote.mode} — {QUOTE_STATUS_LABELS[p.quote.status] ?? p.quote.status}
                      </Link>
                    </p>
                    {p.quote.totalValueCents != null && (
                      <p className="text-gray-600">Valor: {formatCentsToBRL(p.quote.totalValueCents)}</p>
                    )}
                  </>
                )}
                {p.accuracyMeters != null && (
                  <p className="text-xs text-gray-400">Precisão aproximada: ±{Math.round(p.accuracyMeters)} m</p>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
