import { describe, expect, it } from "vitest";
import { phoneDetails } from "./customer-phones";
import { optionalPhone } from "./customer-validation";
import { parseCustomerImportTable } from "./customer-import";

describe("customer phones", () => {
  it("identifies Brazilian landlines and mobiles", () => {
    expect(phoneDetails("(11) 3456-7890").kind).toBe("Fixo");
    expect(phoneDetails("+55 11 99999-8888").kind).toBe("Celular");
    expect(phoneDetails(null).whatsappUrl).toBeNull();
  });
  it("does not confuse DDD 55 with the country code", () => {
    expect(phoneDetails("55999998888").whatsappUrl).toBe("https://wa.me/5555999998888");
    expect(phoneDetails("5511999998888").whatsappUrl).toBe("https://wa.me/5511999998888");
    expect(phoneDetails("1134567890").telephoneUrl).toBe("tel:+551134567890");
  });
  it("keeps numbers optional and validates supplied numbers", () => {
    expect(optionalPhone().parse("")).toBeNull();
    expect(optionalPhone().safeParse("abc").success).toBe(false);
    expect(optionalPhone().parse("(11) 3456-7890")).toBe("1134567890");
  });
  it("imports additional numbers and explicitly declared Business", () => {
    const parsed = parseCustomerImportTable([["Nome", "Telefone 2", "Telefone 3", "Tipo telefone 3"], ["Maria", "1134567890", "11999998888", "WhatsApp Business"]]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ phoneDigits: null, phone2Digits: "1134567890", phone3Digits: "11999998888", phone3Channel: "WHATSAPP_BUSINESS" });
  });
  it("rejects invalid extra numbers and unknown channel values", () => {
    const parsed = parseCustomerImportTable([["Nome", "Telefone 2", "Tipo telefone 2"], ["Maria", "123", "errado"]]);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.issues[0].message).toContain("phone2Digits");
    expect(parsed.issues[0].message).toContain("phone2Channel");
  });
});
