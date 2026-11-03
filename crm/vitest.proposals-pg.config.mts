// Integração das propostas com PostgreSQL REAL e descartável (ponte Olist
// simulada). Não faz parte de `npm test`. Uso:
//   PROPOSALS_PG_TEST_URL=postgresql://.../banco_descartavel node node_modules/vitest/vitest.mjs run -c vitest.proposals-pg.config.mts
// O teste apaga e recria os dados do banco informado: NUNCA aponte para
// banco de produção ou de desenvolvimento compartilhado.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)) },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  test: {
    include: ["src/**/*.pg-test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
