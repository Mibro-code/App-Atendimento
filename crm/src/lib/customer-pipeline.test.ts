import { describe, expect, it } from "vitest";
import { classifyCustomerPipeline, hasCompleteCustomerProfile } from "./customer-pipeline";

describe("customer pipeline", () => {
  const now = new Date("2026-09-16T12:00:00Z");
  it("keeps untouched customers in the first column", () => expect(classifyCustomerPipeline({ status:"NOVO",activities:0,quotes:0,lastConfirmedSaleAt:null,followUpAfterDays:30,now }).stage).toBe("NEW"));
  it("moves contacted or quoted customers to service", () => expect(classifyCustomerPipeline({ status:"NOVO",activities:1,quotes:0,lastConfirmedSaleAt:null,followUpAfterDays:30,now }).stage).toBe("IN_PROGRESS"));
  it("moves a complete imported profile to service", () => expect(classifyCustomerPipeline({ status:"NOVO",activities:0,quotes:0,profileComplete:true,lastConfirmedSaleAt:null,followUpAfterDays:30,now }).stage).toBe("IN_PROGRESS"));
  it("keeps recent buyers as sold", () => expect(classifyCustomerPipeline({ status:"CLIENTE_ATIVO",activities:1,quotes:1,lastConfirmedSaleAt:new Date("2026-09-10T12:00:00Z"),followUpAfterDays:30,now }).stage).toBe("SOLD"));
  it("returns buyers for repurchase after the seller follow-up period", () => expect(classifyCustomerPipeline({ status:"CLIENTE_ATIVO",activities:1,quotes:1,lastConfirmedSaleAt:new Date("2026-08-01T12:00:00Z"),followUpAfterDays:30,now }).returningForRepurchase).toBe(true));
});

describe("complete customer profile", () => {
  const complete = { contactName:"Maria",legalName:"Empresa Ltda",email:"maria@empresa.com",state:"SP",businessType:"LOJA_VIRTUAL",industrySegment:"Eletrônicos",interests:["SMARTWATCH"],interestedBrand:"MIBRO" };
  it("accepts a fully identified and contactable customer", () => expect(hasCompleteCustomerProfile(complete)).toBe(true));
  it("keeps incomplete rows as new", () => expect(hasCompleteCustomerProfile({ ...complete, state:null })).toBe(false));
});
