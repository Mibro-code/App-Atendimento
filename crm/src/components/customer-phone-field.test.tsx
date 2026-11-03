import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerPhoneField } from "./customer-phone-field";

describe("CustomerPhoneField", () => {
  it("renders only an optional phone input without type selectors or Business warnings", () => {
    const html = renderToStaticMarkup(createElement(CustomerPhoneField, { label: "Telefone 2", value: "", onValue: () => {} }));
    expect(html).toContain("Telefone 2 (opcional)");
    expect(html).toContain('type="tel"');
    expect(html).not.toContain("required");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Uso do número");
    expect(html).not.toContain("Business");
  });
});
