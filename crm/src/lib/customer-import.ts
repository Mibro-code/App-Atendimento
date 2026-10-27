import type { BusinessType, CustomerInterestedBrand, CustomerInterest, CustomerStatus, Temperature } from "@prisma/client";
import { normalizeEmail, onlyDigits } from "./format";
import { PHONE_CHANNELS } from "./customer-phones";
import { optionalPhone } from "./customer-validation";

export const CUSTOMER_IMPORT_MAX_ROWS = 1000;
export const CUSTOMER_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export interface CustomerImportRow {
  rowNumber: number;
  contactName: string;
  legalName: string | null;
  tradeName: string | null;
  cnpjDigits: string | null;
  cpfDigits: string | null;
  email: string | null;
  phoneDigits: string | null;
  phone2Digits?: string | null;
  phone3Digits?: string | null;
  phoneChannel?: string | null;
  phone2Channel?: string | null;
  phone3Channel?: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressDistrict: string | null;
  city: string | null;
  state: string | null;
  spRegion: string | null;
  businessType: BusinessType | null;
  industrySegment: string | null;
  worksWithSmartwatch: boolean | null;
  interests: CustomerInterest[];
  interestedBrand: CustomerInterestedBrand | null;
  leadCapturedAt: Date | null;
  zipDigits: string | null;
  leadOrigin: string | null;
  notes: string | null;
  status: CustomerStatus;
  temperature: Temperature;
}

export interface CustomerImportIssue {
  rowNumber: number;
  message: string;
}

const HEADER_ALIASES: Record<keyof Omit<CustomerImportRow, "rowNumber" | "status" | "temperature"> | "status" | "temperature", string[]> = {
  contactName: ["nome", "cliente", "nome do cliente", "nome do contato", "contato", "contactname"],
  legalName: ["razao social", "razao", "nome empresarial", "legalname"],
  tradeName: ["nome fantasia", "fantasia", "empresa", "tradename"],
  cnpjDigits: ["cnpj", "cnpj digits", "cnpjdigits"],
  cpfDigits: ["cpf", "cpf digits", "cpfdigits"],
  email: ["email", "e mail", "correio eletronico"],
  phoneDigits: [
    "telefone",
    "celular",
    "whats",
    "whatsapp",
    "telefone whatsapp",
    "numero do whatsapp",
    "numero whatsapp",
    "numero de telefone",
    "phone",
    "phonedigits",
  ],
  addressStreet: ["endereco", "logradouro", "rua", "addressstreet"],
  phone2Digits: ["telefone 2", "celular 2", "whatsapp 2", "numero 2", "phone2digits"],
  phone3Digits: ["telefone 3", "celular 3", "whatsapp 3", "numero 3", "phone3digits"],
  phoneChannel: ["tipo telefone", "uso telefone", "phonechannel"],
  phone2Channel: ["tipo telefone 2", "uso telefone 2", "phone2channel"],
  phone3Channel: ["tipo telefone 3", "uso telefone 3", "phone3channel"],
  addressNumber: ["numero", "n do endereco", "addressnumber"],
  addressDistrict: ["bairro", "addressdistrict"],
  city: ["cidade", "municipio", "city"],
  state: ["uf", "estado", "state"],
  spRegion: ["regiao", "regiao sp", "regiao de sp", "regiao de sao paulo", "regional", "sp region"],
  businessType: ["tipo de negocio", "tipo negocio", "modelo de negocio", "business type"],
  industrySegment: ["segmento de atuacao", "segmento", "ramo", "ramo de atuacao"],
  worksWithSmartwatch: ["ja trabalha com smartwatch", "trabalha com smartwatch", "vende smartwatch"],
  interests: ["interesse", "interesses", "produto de interesse", "produtos de interesse"],
  interestedBrand: ["empresa de interesse", "marca de interesse"],
  leadCapturedAt: ["carimbo de data hora", "data hora", "data de cadastro", "timestamp"],
  zipDigits: ["cep", "codigo postal", "zip", "zipdigits"],
  leadOrigin: ["origem", "origem do lead", "canal", "leadorigin"],
  notes: ["observacoes", "observacao", "notas", "notes"],
  status: ["status", "situacao"],
  temperature: ["temperatura", "temperature"],
};

const STATUS_ALIASES: Record<string, CustomerStatus> = {
  novo: "NOVO",
  "contato realizado": "CONTATO_REALIZADO",
  "em negociacao": "EM_NEGOCIACAO",
  "cotacao enviada": "COTACAO_ENVIADA",
  "aguardando retorno": "AGUARDANDO_RETORNO",
  "aguardando pagamento": "AGUARDANDO_PAGAMENTO",
  "cliente ativo": "CLIENTE_ATIVO",
  "sem interesse": "SEM_INTERESSE",
  "venda perdida": "VENDA_PERDIDA",
  inativo: "INATIVO",
};

const TEMPERATURE_ALIASES: Record<string, Temperature> = {
  quente: "QUENTE",
  morno: "MORNO",
  frio: "FRIO",
  "sem classificacao": "SEM_CLASSIFICACAO",
};

const BUSINESS_TYPE_ALIASES: Record<string, BusinessType> = {
  "loja virtual": "LOJA_VIRTUAL",
  ecommerce: "LOJA_VIRTUAL",
  "e commerce": "LOJA_VIRTUAL",
  "loja fisica": "LOJA_FISICA",
  "loja fisica virtual": "LOJA_FISICA_E_VIRTUAL",
  "loja fisica e virtual": "LOJA_FISICA_E_VIRTUAL",
  "fisica virtual": "LOJA_FISICA_E_VIRTUAL",
  ambos: "LOJA_FISICA_E_VIRTUAL",
  outro: "OUTRO",
};

const INTEREST_ALIASES: Record<string, CustomerInterest> = {
  smartwatch: "SMARTWATCH",
  smartwatches: "SMARTWATCH",
  "oculos ia": "OCULOS_IA",
  "oculos de ia": "OCULOS_IA",
  "oculos inteligente": "OCULOS_IA",
  "fone de ouvido": "FONE_DE_OUVIDO",
  fone: "FONE_DE_OUVIDO",
  headphones: "FONE_DE_OUVIDO",
};

const STATE_ALIASES: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE",
  "distrito federal": "DF", "espirito santo": "ES", goias: "GO", maranhao: "MA",
  "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG", para: "PA",
  paraiba: "PB", parana: "PR", pernambuco: "PE", piaui: "PI", "rio de janeiro": "RJ",
  "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO", roraima: "RR",
  "santa catarina": "SC", "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
};

function normalizedText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizedKey(value: unknown): string {
  return normalizedText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nullable(value: unknown): string | null {
  return normalizedText(value) || null;
}

function parseStatus(value: unknown): CustomerStatus | null {
  const key = normalizedKey(value);
  if (!key) return "NOVO";
  return STATUS_ALIASES[key] ?? STATUS_ALIASES[key.replace(/_/g, " ")] ?? null;
}

function parseTemperature(value: unknown): Temperature | null {
  const key = normalizedKey(value);
  if (!key) return "SEM_CLASSIFICACAO";
  return TEMPERATURE_ALIASES[key] ?? null;
}

function parseState(value: unknown): string | null {
  const raw = normalizedText(value);
  if (!raw) return null;
  const key = normalizedKey(raw);
  return STATE_ALIASES[key] || raw.toUpperCase();
}

function parseBusinessType(value: unknown): BusinessType | null | undefined {
  const key = normalizedKey(value);
  if (!key) return null;
  return BUSINESS_TYPE_ALIASES[key];
}

function parseBoolean(value: unknown): boolean | null | undefined {
  const key = normalizedKey(value);
  if (!key) return null;
  if (["sim", "s", "yes", "1", "verdadeiro"].includes(key)) return true;
  if (["nao", "n", "no", "0", "falso"].includes(key)) return false;
  return undefined;
}

function parseInterests(value: unknown): CustomerInterest[] | null {
  const text = normalizedText(value);
  if (!text) return [];
  const parsed = text.split(/[,;|/]+/).map((item) => INTEREST_ALIASES[normalizedKey(item)]).filter(Boolean);
  return parsed.length === text.split(/[,;|/]+/).filter((item) => normalizedText(item)).length
    ? [...new Set(parsed)]
    : null;
}

function parseBrand(value: unknown): CustomerInterestedBrand | null | undefined {
  const key = normalizedKey(value);
  if (!key) return null;
  if (key === "mibro") return "MIBRO";
  if (key === "sincrofit") return "SINCROFIT";
  if (["ambas", "mibro e sincrofit", "mibro sincrofit", "as duas", "duas empresas"].includes(key)) return "AMBAS";
  return undefined;
}

function parseCapturedAt(value: unknown): Date | null | undefined {
  const text = normalizedText(value);
  if (!text) return null;
  const brazil = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  const date = brazil
    ? new Date(`${brazil[3]}-${brazil[2].padStart(2, "0")}-${brazil[1].padStart(2, "0")}T${(brazil[4] || "00").padStart(2, "0")}:${brazil[5] || "00"}:${brazil[6] || "00"}-03:00`)
    : new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function parseDelimitedText(input: string, rowLimit = CUSTOMER_IMPORT_MAX_ROWS + 2): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      if (rows.length >= rowLimit) return rows;
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export function parseCustomerImportTable(table: unknown[][]): {
  rows: CustomerImportRow[];
  issues: CustomerImportIssue[];
  recognizedHeaders: string[];
} {
  if (table.length < 2) {
    return { rows: [], issues: [{ rowNumber: 1, message: "A planilha precisa ter cabeçalho e ao menos um cliente." }], recognizedHeaders: [] };
  }

  const headerLookup = new Map<string, keyof typeof HEADER_ALIASES>();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) headerLookup.set(normalizedKey(alias), field as keyof typeof HEADER_ALIASES);
  }
  const columnMap = new Map<keyof typeof HEADER_ALIASES, number>();
  table[0].forEach((header, index) => {
    const field = headerLookup.get(normalizedKey(header));
    if (field && !columnMap.has(field)) columnMap.set(field, index);
  });

  const missingRequiredColumns = [
    ...(!columnMap.has("contactName") ? ['"Nome do cliente"'] : []),
  ];
  if (missingRequiredColumns.length > 0) {
    return {
      rows: [],
      issues: [{
        rowNumber: 1,
        message: `Não foi encontrada a coluna obrigatória ${missingRequiredColumns.join(" e ")}.`,
      }],
      recognizedHeaders: [...columnMap.keys()],
    };
  }

  const rows: CustomerImportRow[] = [];
  const issues: CustomerImportIssue[] = [];
  const value = (row: unknown[], field: keyof typeof HEADER_ALIASES) => {
    const index = columnMap.get(field);
    return index === undefined ? "" : row[index];
  };

  for (let index = 1; index < table.length && index <= CUSTOMER_IMPORT_MAX_ROWS; index += 1) {
    const source = table[index];
    if (!source?.some((cell) => normalizedText(cell))) continue;
    const rowNumber = index + 1;
    const contactName = normalizedText(value(source, "contactName"));
    const cnpjDigits = onlyDigits(normalizedText(value(source, "cnpjDigits"))) || null;
    const cpfDigits = onlyDigits(normalizedText(value(source, "cpfDigits"))) || null;
    const email = normalizeEmail(normalizedText(value(source, "email"))) || null;
    const phoneDigits = onlyDigits(normalizedText(value(source, "phoneDigits"))) || null;
    const spRegion = nullable(value(source, "spRegion"));
    const state = parseState(value(source, "state")) ?? (spRegion ? "SP" : null);
    const businessType = parseBusinessType(value(source, "businessType"));
    const worksWithSmartwatch = parseBoolean(value(source, "worksWithSmartwatch"));
    const interests = parseInterests(value(source, "interests"));
    const interestedBrand = parseBrand(value(source, "interestedBrand"));
    const leadCapturedAt = parseCapturedAt(value(source, "leadCapturedAt"));
    const status = parseStatus(value(source, "status"));
    const temperature = parseTemperature(value(source, "temperature"));
    const rowIssues: string[] = [];
    const extraPhones = {
      phone2Digits: onlyDigits(normalizedText(value(source, "phone2Digits"))) || null,
      phone3Digits: onlyDigits(normalizedText(value(source, "phone3Digits"))) || null,
    };
    for (const field of ["phone2Digits", "phone3Digits"] as const) {
      if (!optionalPhone().safeParse(normalizedText(value(source, field))).success) rowIssues.push(`${field}: informe telefone com DDD (10 a 13 dígitos)`);
    }
    const channels = { phoneChannel: null, phone2Channel: null, phone3Channel: null } as Record<"phoneChannel" | "phone2Channel" | "phone3Channel", string | null>;
    for (const field of Object.keys(channels) as (keyof typeof channels)[]) {
      const raw = normalizedKey(value(source, field));
      const channel = ({ "somente telefone": "PHONE", telefone: "PHONE", fixo: "PHONE", celular: "PHONE", phone: "PHONE", whatsapp: "WHATSAPP", "whatsapp business": "WHATSAPP_BUSINESS" } as Record<string, string>)[raw];
      if (raw && (!channel || !PHONE_CHANNELS.includes(channel as typeof PHONE_CHANNELS[number]))) rowIssues.push(`${field}: use Telefone, WhatsApp ou WhatsApp Business`);
      channels[field] = channel || null;
    }

    if (contactName.length < 2) rowIssues.push("nome do contato obrigatório (mínimo de 2 caracteres)");
    if (cnpjDigits && cnpjDigits.length !== 14) rowIssues.push("CNPJ deve ter 14 dígitos");
    if (cpfDigits && cpfDigits.length !== 11) rowIssues.push("CPF deve ter 11 dígitos");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) rowIssues.push("e-mail inválido");
    if (phoneDigits && (phoneDigits.length < 10 || phoneDigits.length > 13)) rowIssues.push("WhatsApp/telefone deve ter entre 10 e 13 dígitos quando informado");
    if (state && state.length !== 2) rowIssues.push("UF deve ter 2 letras");
    if (spRegion && state !== "SP") rowIssues.push("região de SP só pode ser usada em clientes do estado SP");
    if (spRegion && spRegion.length > 100) rowIssues.push("região de SP deve ter no máximo 100 caracteres");
    if (businessType === undefined) rowIssues.push("tipo de negócio não reconhecido");
    if (worksWithSmartwatch === undefined) rowIssues.push("'Já trabalha com Smartwatch' deve ser Sim ou Não");
    if (interests === null) rowIssues.push("interesse não reconhecido");
    if (interestedBrand === undefined) rowIssues.push("empresa de interesse deve ser Mibro, Sincrofit ou ambas");
    if (leadCapturedAt === undefined) rowIssues.push("carimbo de data/hora inválido");
    if (!status) rowIssues.push("status não reconhecido");
    if (!temperature) rowIssues.push("temperatura não reconhecida");

    if (rowIssues.length > 0) {
      issues.push({ rowNumber, message: rowIssues.join("; ") });
      continue;
    }

    rows.push({
      ...extraPhones,
      ...channels,
      rowNumber,
      contactName,
      legalName: nullable(value(source, "legalName")),
      tradeName: nullable(value(source, "tradeName")),
      cnpjDigits,
      cpfDigits,
      email,
      phoneDigits,
      addressStreet: nullable(value(source, "addressStreet")),
      addressNumber: nullable(value(source, "addressNumber")),
      addressDistrict: nullable(value(source, "addressDistrict")),
      city: nullable(value(source, "city")),
      state,
      spRegion,
      businessType: businessType ?? null,
      industrySegment: nullable(value(source, "industrySegment")),
      worksWithSmartwatch: worksWithSmartwatch ?? null,
      interests: interests ?? [],
      interestedBrand: interestedBrand ?? null,
      leadCapturedAt: leadCapturedAt ?? null,
      zipDigits: onlyDigits(normalizedText(value(source, "zipDigits"))) || null,
      leadOrigin: nullable(value(source, "leadOrigin")),
      notes: nullable(value(source, "notes")),
      status: status!,
      temperature: temperature!,
    });
  }

  if (table.length - 1 > CUSTOMER_IMPORT_MAX_ROWS) {
    issues.push({ rowNumber: CUSTOMER_IMPORT_MAX_ROWS + 2, message: `O limite é de ${CUSTOMER_IMPORT_MAX_ROWS} clientes por importação.` });
  }

  return { rows, issues, recognizedHeaders: [...columnMap.keys()] };
}

export function duplicateKey(row: CustomerImportRow): string[] {
  return [
    row.cnpjDigits ? `cnpj:${row.cnpjDigits}` : "",
    row.cpfDigits ? `cpf:${row.cpfDigits}` : "",
    row.email ? `email:${row.email}` : "",
    row.phoneDigits ? `phone:${row.phoneDigits}` : "",
  ].filter(Boolean);
}
