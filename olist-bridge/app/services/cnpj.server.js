import https from "node:https";

const DEFAULT_PROVIDER_URL = "https://brasilapi.com.br/api/cnpj/v1";
const DEFAULT_CNPJA_API_URL = "https://api.cnpja.com";
const DEFAULT_CNPJA_PUBLIC_URL = "https://open.cnpja.com/office";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

const lookupCache = new Map();

export function onlyCnpjDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

export function isValidCnpj(value) {
  const digits = onlyCnpjDigits(value);

  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) {
    return false;
  }

  const calculateDigit = (length) => {
    let factor = length - 7;
    let sum = 0;

    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * factor;
      factor -= 1;

      if (factor === 1) {
        factor = 9;
      }
    }

    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  return (
    calculateDigit(12) === Number(digits[12]) &&
    calculateDigit(13) === Number(digits[13])
  );
}

function text(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function joinAddress(record) {
  const street = [
    text(record.descricao_tipo_de_logradouro),
    text(record.logradouro),
  ]
    .filter(Boolean)
    .join(" ");
  const streetAndNumber = [street, text(record.numero)]
    .filter(Boolean)
    .join(", ");

  return [
    streetAndNumber,
    text(record.complemento),
    text(record.bairro),
    [text(record.municipio), text(record.uf)].filter(Boolean).join(" - "),
    text(record.cep),
  ]
    .filter(Boolean)
    .join(", ");
}

export function normalizeCnpjRecord(record, fallbackCnpj = "") {
  return {
    cnpj: onlyCnpjDigits(record.cnpj || fallbackCnpj),
    legalName: text(record.razao_social),
    tradeName: text(record.nome_fantasia),
    registrationStatus: text(record.descricao_situacao_cadastral),
    registrationStatusDate: text(record.data_situacao_cadastral),
    openedAt: text(record.data_inicio_atividade),
    mainActivity: text(record.cnae_fiscal_descricao),
    mainActivityCode: text(record.cnae_fiscal),
    phone: text(record.ddd_telefone_1 || record.ddd_telefone_2),
    email: text(record.email).toLowerCase(),
    address: {
      street: [
        text(record.descricao_tipo_de_logradouro),
        text(record.logradouro),
      ]
        .filter(Boolean)
        .join(" "),
      number: text(record.numero),
      complement: text(record.complemento),
      district: text(record.bairro),
      city: text(record.municipio),
      state: text(record.uf),
      postalCode: text(record.cep),
      formatted: joinAddress(record),
    },
  };
}

function unavailableStateRegistration(state = "") {
  return {
    number: "",
    state,
    status: "",
    enabled: null,
    icmsTaxpayer: null,
    available: false,
  };
}

export function normalizeStateRegistration(record, preferredState = "") {
  if (!Array.isArray(record?.registrations)) {
    return unavailableStateRegistration(preferredState);
  }

  const registrations = record.registrations.filter(
    (registration) => registration && registration.number,
  );
  const preferred = text(preferredState).toUpperCase();
  const selected =
    registrations.find(
      (registration) =>
        text(registration.state).toUpperCase() === preferred &&
        registration.enabled === true,
    ) ||
    registrations.find(
      (registration) =>
        text(registration.state).toUpperCase() === preferred,
    ) ||
    registrations.find((registration) => registration.enabled === true) ||
    registrations[0];

  if (!selected) {
    return {
      ...unavailableStateRegistration(preferred),
      enabled: false,
      icmsTaxpayer: false,
      available: true,
    };
  }

  const status = text(selected.status?.text || selected.status);
  const enabled =
    typeof selected.enabled === "boolean"
      ? selected.enabled
      : /^(ativa|ativo|habilitada|habilitado)$/i.test(status);

  return {
    number: text(selected.number),
    state: text(selected.state || preferred).toUpperCase(),
    status,
    enabled,
    icmsTaxpayer: enabled,
    available: true,
  };
}

function fetchCnpja(url, headers, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {headers, family: 4},
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          const status = response.statusCode || 0;
          let data = null;

          try {
            data = body ? JSON.parse(body) : null;
          } catch {
            data = null;
          }

          resolve({
            ok: status >= 200 && status < 300,
            status,
            data,
          });
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Tempo limite da consulta de IE excedido."));
    });
    request.on("error", reject);
  });
}

async function lookupStateRegistration(cnpj, state, options = {}) {
  const apiKey =
    options.cnpjaApiKey === undefined
      ? process.env.CNPJA_API_KEY
      : options.cnpjaApiKey;
  const configuredBaseUrl =
    options.cnpjaBaseUrl || process.env.CNPJA_API_BASE_URL;
  const baseUrl = String(
    configuredBaseUrl ||
      (apiKey ? DEFAULT_CNPJA_API_URL : DEFAULT_CNPJA_PUBLIC_URL),
  )
    .replace(/\/+$/, "")
    .replace(/\/office$/i, "");
  const url = apiKey
    ? new URL(`${baseUrl}/ccc`)
    : new URL(
        `${DEFAULT_CNPJA_PUBLIC_URL}/${encodeURIComponent(cnpj)}`,
      );

  if (apiKey) {
    url.searchParams.set("taxId", cnpj);
    url.searchParams.set("states", state || "BR");
  }

  const headers = {
    Accept: "application/json",
  };

  if (apiKey) {
    headers.Authorization = apiKey;
  }

  try {
    const response = apiKey
      ? await fetchCnpja(url, headers)
      : await (options.fetchImpl || fetch)(url, {
          headers,
          signal: AbortSignal.timeout(15000),
        });

    if (!response.ok) {
      console.error("Falha na consulta de Inscrição Estadual", {
        cnpj,
        state,
        status: response.status,
      });
      return unavailableStateRegistration(state);
    }

    const record = apiKey ? response.data : await response.json();
    return normalizeStateRegistration(record, state);
  } catch (error) {
    console.error("Erro ao consultar Inscrição Estadual", {
      cnpj,
      state,
      message: error.message,
    });
    return unavailableStateRegistration(state);
  }
}

function getCached(cnpj) {
  const cached = lookupCache.get(cnpj);

  if (!cached) {
    return null;
  }

  if (
    Date.now() - cached.createdAt >
    (cached.ttlMs || CACHE_TTL_MS)
  ) {
    lookupCache.delete(cnpj);
    return null;
  }

  return cached.value;
}

function cacheResult(cnpj, value) {
  if (lookupCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = lookupCache.keys().next().value;
    lookupCache.delete(oldestKey);
  }

  lookupCache.set(cnpj, {
    createdAt: Date.now(),
    ttlMs: value.stateRegistration?.available
      ? CACHE_TTL_MS
      : 5 * 60 * 1000,
    value,
  });
}

export async function lookupCnpj(value, options = {}) {
  const cnpj = onlyCnpjDigits(value);

  if (!isValidCnpj(cnpj)) {
    const error = new Error("CNPJ inválido.");
    error.code = "INVALID_CNPJ";
    throw error;
  }

  const cached = getCached(cnpj);

  if (cached) {
    return cached;
  }

  const baseUrl = String(
    options.baseUrl ||
      process.env.CNPJ_API_BASE_URL ||
      DEFAULT_PROVIDER_URL,
  ).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl || fetch;
  const headers = {
    Accept: "application/json",
    "User-Agent": "clientes-login-tt/1.0 (CNPJ lookup)",
  };

  if (process.env.CNPJ_API_TOKEN) {
    headers.Authorization = `Bearer ${process.env.CNPJ_API_TOKEN}`;
  }

  let response;

  try {
    response = await fetchImpl(
      `${baseUrl}/${encodeURIComponent(cnpj)}`,
      {
        headers,
        signal: AbortSignal.timeout(15000),
      },
    );
  } catch (cause) {
    const error = new Error(
      "O serviço de consulta de CNPJ está indisponível.",
      {cause},
    );
    error.code = "PROVIDER_UNAVAILABLE";
    throw error;
  }

  if (response.status === 404) {
    const error = new Error("CNPJ não encontrado.");
    error.code = "CNPJ_NOT_FOUND";
    throw error;
  }

  if (!response.ok) {
    const error = new Error(
      "O serviço de consulta de CNPJ não respondeu corretamente.",
    );
    error.code = "PROVIDER_ERROR";
    error.status = response.status;
    throw error;
  }

  const result = normalizeCnpjRecord(await response.json(), cnpj);

  if (!result.cnpj || !result.legalName) {
    const error = new Error("A consulta não retornou os dados da empresa.");
    error.code = "INCOMPLETE_PROVIDER_RESPONSE";
    throw error;
  }

  result.stateRegistration = await lookupStateRegistration(
    cnpj,
    result.address.state,
    options,
  );

  cacheResult(cnpj, result);
  return result;
}
