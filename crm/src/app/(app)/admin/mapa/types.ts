export interface MapPoint {
  id: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  capturedAt: string;
  locationSource: string;
  customer: {
    id: string | undefined;
    name: string;
    city: string | null;
    state: string | null;
  };
  seller: {
    id: string;
    name: string;
  };
  quote: {
    id: string;
    status: string;
    totalValueCents: number | null;
    mode: string;
  } | null;
}

export interface MapMetrics {
  presencialCount: number;
  activeSellersCount: number;
  citiesAttended: number;
  proposedByState: { state: string; valueCents: number }[];
  soldByState: { state: string; valueCents: number }[];
}

export interface SellerOption {
  id: string;
  name: string;
}

export interface LocationCapturesResponse {
  points: MapPoint[];
  metrics: MapMetrics;
  sellers: SellerOption[];
  period: { from: string; to: string };
}
