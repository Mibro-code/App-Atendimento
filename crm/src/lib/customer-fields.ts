export const BUSINESS_TYPE_VALUES = ["LOJA_VIRTUAL", "LOJA_FISICA", "LOJA_FISICA_E_VIRTUAL", "OUTRO"] as const;
export const BUSINESS_TYPE_LABELS: Record<(typeof BUSINESS_TYPE_VALUES)[number], string> = {
  LOJA_VIRTUAL: "Loja virtual",
  LOJA_FISICA: "Loja física",
  LOJA_FISICA_E_VIRTUAL: "Loja física + virtual",
  OUTRO: "Outro",
};

export const CUSTOMER_INTEREST_VALUES = ["SMARTWATCH", "OCULOS_IA", "FONE_DE_OUVIDO"] as const;
export const CUSTOMER_INTEREST_LABELS: Record<(typeof CUSTOMER_INTEREST_VALUES)[number], string> = {
  SMARTWATCH: "Smartwatch",
  OCULOS_IA: "Óculos IA",
  FONE_DE_OUVIDO: "Fone de ouvido",
};

export const INTERESTED_BRAND_VALUES = ["MIBRO", "SINCROFIT", "AMBAS"] as const;
export const INTERESTED_BRAND_LABELS: Record<(typeof INTERESTED_BRAND_VALUES)[number], string> = {
  MIBRO: "Mibro",
  SINCROFIT: "Sincrofit",
  AMBAS: "Mibro e Sincrofit",
};
