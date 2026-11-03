import test from "node:test";
import assert from "node:assert/strict";

import {
  extractOlistOrderStatus,
  isApprovedOlistOrderStatus,
} from "../app/services/olist-order-status-rules.js";

test("reconhece as variações aprovadas da Olist", () => {
  for (const value of ["Aprovado", "aprovado", "APROVADO", "Approved"]) {
    assert.equal(isApprovedOlistOrderStatus(value), true);
  }
});

test("não finaliza pedidos ainda abertos ou cancelados", () => {
  for (const value of ["aberto", "Em aberto", "cancelado", "faturado"]) {
    assert.equal(isApprovedOlistOrderStatus(value), false);
  }
});

test("extrai situação textual de respostas Olist distintas", () => {
  assert.equal(extractOlistOrderStatus({ situacao: "Aprovado" }), "aprovado");
  assert.equal(
    extractOlistOrderStatus({ situacao: { descricao: "Aprovado" } }),
    "aprovado",
  );
  assert.equal(
    extractOlistOrderStatus(null, { descricaoSituacao: "Aprovado" }),
    "aprovado",
  );
});
