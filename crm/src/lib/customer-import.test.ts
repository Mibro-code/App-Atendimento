import { describe, expect, it } from "vitest";
import { duplicateKey, parseCustomerImportTable, parseDelimitedText } from "./customer-import";

describe("customer import", () => {
  it("recognizes flexible Portuguese headers and normalizes values", () => {
    const parsed = parseCustomerImportTable([
      ["Carimbo de data/hora", "Cliente", "Razão Social", "WhatsApp", "E-mail", "Situação", "Temperatura", "Estado", "Cidade", "Tipo de negócio", "Segmento de atuação", "Já trabalha com Smartwatch", "Interesse", "Empresa de interesse"],
      ["10/09/2026 10:30:00", "João Silva", "Empresa Ltda", "(11) 99999-9999", " JOAO@EXEMPLO.COM ", "Em negociação", "Quente", "São Paulo", "Campinas", "Loja física + Virtual", "Eletrônicos", "Sim", "Smartwatch, Óculos IA", "Sincrofit"],
    ]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      contactName: "João Silva",
      legalName: "Empresa Ltda",
      phoneDigits: "11999999999",
      email: "joao@exemplo.com",
      status: "EM_NEGOCIACAO",
      temperature: "QUENTE",
      state: "SP",
      city: "Campinas",
      businessType: "LOJA_FISICA_E_VIRTUAL",
      industrySegment: "Eletrônicos",
      worksWithSmartwatch: true,
      interests: ["SMARTWATCH", "OCULOS_IA"],
      interestedBrand: "SINCROFIT",
      leadCapturedAt: new Date("2026-09-10T13:30:00.000Z"),
    });
  });

  it("reports missing name column and invalid rows", () => {
    expect(parseCustomerImportTable([["CNPJ"], ["123"]]).issues[0].message).toContain("Nome");
    const parsed = parseCustomerImportTable([["Nome", "WhatsApp", "CNPJ"], ["A", "", "123"]]);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.issues[0].message).toContain("CNPJ");
  });

  it("requires only the name column and accepts an empty phone", () => {
    const missingPhone = parseCustomerImportTable([["Nome", "E-mail"], ["Maria", "maria@x.com"]]);
    expect(missingPhone.rows).toHaveLength(1);
    expect(missingPhone.rows[0].phoneDigits).toBeNull();

    const blankPhone = parseCustomerImportTable([["Nome", "Whats"], ["Maria", ""]]);
    expect(blankPhone.rows).toHaveLength(1);
    expect(blankPhone.rows[0].phoneDigits).toBeNull();
  });

  it("accepts both companies as customer interest", () => {
    const parsed = parseCustomerImportTable([["Nome", "Empresa de interesse"], ["Cliente Duplo", "Mibro e Sincrofit"]]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0].interestedBrand).toBe("AMBAS");
  });

  it("imports a São Paulo region and infers the state when it is omitted", () => {
    const parsed = parseCustomerImportTable([
      ["Nome", "Cidade", "Região de SP"],
      ["Cliente Regional", "Campinas", "Campinas e região"],
    ]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      city: "Campinas",
      state: "SP",
      spRegion: "Campinas e região",
    });
  });

  it("parses semicolon CSV with quoted fields", () => {
    expect(parseDelimitedText('Nome;Observações\r\n"Maria; Souza";"Contato ""VIP"""')).toEqual([
      ["Nome", "Observações"],
      ["Maria; Souza", 'Contato "VIP"'],
    ]);
  });

  it("builds duplicate keys only from populated identifiers", () => {
    const row = parseCustomerImportTable([["Nome", "WhatsApp", "CPF", "E-mail"], ["Maria", "11999999999", "123.456.789-01", "maria@x.com"]]).rows[0];
    expect(duplicateKey(row)).toEqual(["cpf:12345678901", "email:maria@x.com", "phone:11999999999"]);
  });
});
