import { describe, expect, it } from "vitest";
import { isApprovedOlistStatus } from "./olist-status-rules";

describe("status de pedido Olist", () => {
  it.each(["Aprovado", "APROVADO", "aprovada", "Approved", "Pedido aprovado", "Venda aprovada"])(
    "reconhece %s como aprovação",
    (status) => expect(isApprovedOlistStatus(status)).toBe(true)
  );

  it.each(["Aberto", "Em análise", "Cancelado", "Aguardando aprovação"])(
    "não finaliza a venda para %s",
    (status) => expect(isApprovedOlistStatus(status)).toBe(false)
  );
});
