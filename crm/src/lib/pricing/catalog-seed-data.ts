// Dados INICIAIS do catálogo e das tabelas de atacado, usados somente pelo
// seed idempotente (prisma/seed-pricing.ts) e pelos testes. Em execução, os
// preços vêm sempre do banco (PriceTable/PriceEntry) — nunca daqui.
//
// STANDARD: cópia fiel de CATALOGS em
//   C:\ShopifyApps\clientes-login-tt\app\services\wholesale-pricing.server.js
//   (valores efetivamente validados pelo servidor em 08/10/2026).
//   A Sincrofit STANDARD não tem TIER3 no servidor atual: fica sem preço
//   até ser cadastrado na Gestão Comercial (o backend recusa a faixa).
// REPRESENTATIVE: catálogos de representantes de outubro/2026.

import type { CommercialBrand, PriceTier } from "@prisma/client";

export interface SeedVariant {
  sku: string;
  colorName: string;
}

export interface SeedProduct {
  brand: CommercialBrand;
  slug: string;
  name: string;
  sortOrder: number;
  variants: SeedVariant[];
  standard: Partial<Record<PriceTier, number>>;
  representative: Record<PriceTier, number>;
}

const reais = (value: number) => Math.round(value * 100);

function tiers(t1: number, t2: number, t3?: number): Partial<Record<PriceTier, number>> {
  return t3 === undefined
    ? { TIER1: reais(t1), TIER2: reais(t2) }
    : { TIER1: reais(t1), TIER2: reais(t2), TIER3: reais(t3) };
}

function rep(t1: number, t2: number, t3: number): Record<PriceTier, number> {
  return { TIER1: reais(t1), TIER2: reais(t2), TIER3: reais(t3) };
}

export const SEED_PRODUCTS: SeedProduct[] = [
  // ----------------------------------------------------------------- Mibro
  {
    brand: "MIBRO", slug: "c4", name: "Mibro C4", sortOrder: 10,
    variants: [{ sku: "C4-BLACK", colorName: "Black" }, { sku: "C4-SILVER", colorName: "Silver" }],
    standard: tiers(270, 250, 235), representative: rep(278, 257, 242),
  },
  {
    brand: "MIBRO", slug: "a3", name: "Mibro A3", sortOrder: 20,
    variants: [{ sku: "A3-DARK-GRAY", colorName: "Dark Gray" }, { sku: "A3-MOCHA", colorName: "Mocha" }],
    standard: tiers(375, 345, 325), representative: rep(386, 355, 335),
  },
  {
    brand: "MIBRO", slug: "lite-3", name: "Mibro Lite 3", sortOrder: 30,
    variants: [{ sku: "LITE3-DARK-GRAY", colorName: "Dark Gray" }, { sku: "LITE3-LIGHT-GOLD", colorName: "Light Gold" }],
    standard: tiers(390, 360, 340), representative: rep(401, 370, 350),
  },
  {
    brand: "MIBRO", slug: "lite-3-pro", name: "Mibro Lite 3 Pro", sortOrder: 40,
    variants: [
      { sku: "LITE3-PRO-BLACKISH-GREEN", colorName: "Blackish Green" },
      { sku: "LITE3-PRO-KHAKIO-GRAY", colorName: "Khaki Gray" },
      { sku: "LITE3-PRO-ROSE-GOLD", colorName: "Rose Gold" },
    ],
    standard: tiers(540, 500, 475), representative: rep(556, 515, 489),
  },
  {
    brand: "MIBRO", slug: "gs-pro", name: "Mibro GS Pro", sortOrder: 50,
    variants: [{ sku: "GS-PRO-BLACK", colorName: "Black" }],
    standard: tiers(485, 450, 425), representative: rep(499, 463, 438),
  },
  {
    brand: "MIBRO", slug: "gs-pro-2", name: "Mibro GS Pro 2", sortOrder: 60,
    variants: [{ sku: "GS-PRO2-DARK-GRAY", colorName: "Dark Gray" }, { sku: "GS-PRO2-WHITE", colorName: "White" }],
    standard: tiers(710, 660, 625), representative: rep(731, 680, 643),
  },
  {
    brand: "MIBRO", slug: "gs-active", name: "Mibro GS Active", sortOrder: 70,
    variants: [{ sku: "GS-ACTIVE-BLACK", colorName: "Black" }],
    standard: tiers(410, 380, 360), representative: rep(422, 391, 370),
  },
  {
    brand: "MIBRO", slug: "gs-active-2", name: "Mibro GS Active 2", sortOrder: 80,
    variants: [
      { sku: "GS-ACTIVE2-DARK-GRAY", colorName: "Dark Gray" },
      { sku: "GS-ACTIVE2-LIGHT-PURPLE", colorName: "Light Purple" },
    ],
    standard: tiers(560, 520, 495), representative: rep(576, 535, 510),
  },
  // ------------------------------------------------------------- Sincrofit
  {
    brand: "SINCROFIT", slug: "neo", name: "Neo", sortOrder: 10,
    variants: [{ sku: "NEO-PRETO", colorName: "Preto" }, { sku: "NEO-ROSA", colorName: "Rosa" }],
    standard: tiers(210, 188), representative: rep(216, 193, 173),
  },
  {
    brand: "SINCROFIT", slug: "motion-gps", name: "Motion GPS", sortOrder: 20,
    variants: [
      { sku: "MOTION-GPS-PRATA", colorName: "Prata" },
      { sku: "MOTION-GPS-PRETO", colorName: "Preto" },
      // SKU oficial do Olist é DOURADO; nome comercial da cor é Rose Gold.
      { sku: "MOTION-GPS-DOURADO", colorName: "Rose Gold" },
    ],
    standard: tiers(290, 260), representative: rep(298, 268, 242),
  },
  {
    brand: "SINCROFIT", slug: "titan-pro", name: "Titan Pro", sortOrder: 30,
    variants: [{ sku: "TITAN-PRO-PRATA", colorName: "Prata" }, { sku: "TITAN-PRO-PRETO", colorName: "Preto" }],
    standard: tiers(410, 380), representative: rep(422, 391, 360),
  },
];

/** Início da vigência das tabelas iniciais (fixo para o seed ser idempotente). */
export const SEED_EFFECTIVE_FROM = new Date("2026-10-01T03:00:00.000Z"); // 01/10/2026 00:00 BRT
