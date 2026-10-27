"use client";

// Helper client-side único para capturar localização por ação explícita do
// usuário (nunca automático, nunca watchPosition/rastreamento contínuo).
// Reaproveitado por ActivityForm (registro de visita) e CreateProposalPanel
// (início/envio de proposta) — não duplicar esta lógica em outro lugar.

export type LocationCaptureStatus = "GRANTED" | "DENIED" | "UNAVAILABLE" | "TIMEOUT" | "NOT_SUPPORTED";

export interface LocationAttempt {
  status: LocationCaptureStatus;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  capturedAt?: string;
  userAgentSummary: string;
  deviceType: "mobile" | "tablet" | "desktop";
}

// Heurística simples de dispositivo — só contexto leve para diagnóstico,
// nunca usada para fingerprinting.
export function detectDeviceType(): "mobile" | "tablet" | "desktop" {
  const ua = navigator.userAgent;
  const width = window.innerWidth || 0;
  if (/tablet|ipad/i.test(ua) || (width >= 600 && width < 1024 && /android/i.test(ua))) return "tablet";
  if (/mobile|android|iphone/i.test(ua) || width < 600) return "mobile";
  return "desktop";
}

// Resumo curto (navegador + versão + SO), nunca a string completa de user
// agent (evitaria uso como fingerprint).
export function summarizeUserAgent(): string {
  const ua = navigator.userAgent;

  let browser = "Navegador desconhecido";
  const edgeMatch = ua.match(/Edg\/(\d+)/);
  const chromeMatch = ua.match(/Chrome\/(\d+)/);
  const firefoxMatch = ua.match(/Firefox\/(\d+)/);
  const safariMatch = /Safari\//.test(ua) && !chromeMatch ? ua.match(/Version\/(\d+)/) : null;

  if (edgeMatch) browser = `Edge ${edgeMatch[1]}`;
  else if (firefoxMatch) browser = `Firefox ${firefoxMatch[1]}`;
  else if (safariMatch) browser = `Safari ${safariMatch[1]}`;
  else if (chromeMatch) browser = `Chrome ${chromeMatch[1]}`;

  let os = "SO desconhecido";
  if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Linux/.test(ua)) os = "Linux";

  return `${browser} / ${os}`;
}

// Única chamada de geolocalização do app: sempre getCurrentPosition, nunca
// watchPosition. Timeout de 10s (item 7 do pedido) — depois disso segue sem
// localização, nunca trava a ação comercial em andamento.
export function requestLocationAttempt(): Promise<LocationAttempt> {
  const userAgentSummary = summarizeUserAgent();
  const deviceType = detectDeviceType();

  if (!("geolocation" in navigator)) {
    return Promise.resolve({ status: "NOT_SUPPORTED", userAgentSummary, deviceType });
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          status: "GRANTED",
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy,
          capturedAt: new Date().toISOString(),
          userAgentSummary,
          deviceType,
        });
      },
      (geoError) => {
        let status: LocationCaptureStatus = "UNAVAILABLE";
        if (geoError.code === geoError.PERMISSION_DENIED) status = "DENIED";
        else if (geoError.code === geoError.TIMEOUT) status = "TIMEOUT";
        else if (geoError.code === geoError.POSITION_UNAVAILABLE) status = "UNAVAILABLE";
        resolve({ status, userAgentSummary, deviceType });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
}

export const LOCATION_CONSENT_TEXT =
  "Podemos registrar sua localização neste momento para associar o local à proposta. " +
  "Isso é usado apenas para registrar esta visita/proposta e não há rastreamento contínuo.";
