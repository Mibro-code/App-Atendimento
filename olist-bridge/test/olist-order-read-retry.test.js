import assert from "node:assert/strict";
import test from "node:test";

import { retryOlistOrderRead } from "../app/services/olist-order-read-retry.server.js";

test("repete a leitura quando o pedido ainda retorna 404", async () => {
  const waits = [];
  let calls = 0;

  const order = await retryOlistOrderRead(
    async () => {
      calls += 1;
      if (calls < 3) {
        throw Object.assign(new Error("Pedido não encontrado"), { status: 404 });
      }
      return { id: "pedido-1" };
    },
    {
      delays: [100, 200, 300],
      waitFor: async (delay) => waits.push(delay),
    },
  );

  assert.deepEqual(order, { id: "pedido-1" });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [100, 200]);
});

test("não repete erros diferentes de 404", async () => {
  const expected = Object.assign(new Error("Falha interna"), { status: 500 });
  let calls = 0;

  await assert.rejects(
    retryOlistOrderRead(
      async () => {
        calls += 1;
        throw expected;
      },
      { delays: [100], waitFor: async () => {} },
    ),
    (error) => error === expected,
  );

  assert.equal(calls, 1);
});

test("devolve o último 404 após esgotar as tentativas", async () => {
  const errors = [
    Object.assign(new Error("primeiro"), { status: 404 }),
    Object.assign(new Error("segundo"), { status: 404 }),
    Object.assign(new Error("último"), { status: 404 }),
  ];
  let calls = 0;

  await assert.rejects(
    retryOlistOrderRead(
      async () => {
        const error = errors[calls];
        calls += 1;
        throw error;
      },
      { delays: [100, 200], waitFor: async () => {} },
    ),
    (error) => error === errors[2],
  );

  assert.equal(calls, 3);
});