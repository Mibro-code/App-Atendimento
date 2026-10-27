"use client";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2xAsset from "leaflet/dist/images/marker-icon-2x.png";
import markerIconAsset from "leaflet/dist/images/marker-icon.png";
import markerShadowAsset from "leaflet/dist/images/marker-shadow.png";

// Mesmo fix de ícones padrão do Leaflet usado em admin/mapa/map-view.tsx
// (por padrão o Next.js quebra a resolução de URL desses assets).
const markerIcon2x = markerIcon2xAsset.src;
const markerIcon = markerIconAsset.src;
const markerShadow = markerShadowAsset.src;

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow });

const BRAND_ICON = new L.Icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

// Marcador único (não cluster) — detalhe de UMA batida de ponto. Deixa claro
// que é a localização daquele instante, não rastreamento em tempo real.
export default function TimeClockLocationMap({
  latitude,
  longitude,
  accuracyMeters,
  label,
}: {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  label: string;
}) {
  return (
    <div>
      <MapContainer
        center={[latitude, longitude]}
        zoom={16}
        scrollWheelZoom={false}
        style={{ height: "220px", width: "100%", borderRadius: "0.5rem" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> colaboradores'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[latitude, longitude]} icon={BRAND_ICON}>
          <Popup>{label}</Popup>
        </Marker>
      </MapContainer>
      <p className="mt-2 text-xs text-gray-500">
        Localização registrada neste momento da batida — não é rastreamento em tempo real.
        {accuracyMeters != null && <> Precisão: ±{Math.round(accuracyMeters)} m.</>}
      </p>
    </div>
  );
}
