import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  cacheDir: ".olist-flow-test-cache",
  resolve: { alias: [{ find: /^server-only$/, replacement: fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)) }, { find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) }] },
  test: { include: ["src/lib/proposals/*.test.ts", "src/lib/quotes/quote-pdf.test.ts", "src/lib/quote-pdf-route.test.ts", "src/lib/quote-whatsapp-origin.test.ts"], fileParallelism: false, env: { CRM_PROPOSALS_OLIST_ENABLED: "1" } },
});
