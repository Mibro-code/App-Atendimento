import {mkdir, writeFile} from "node:fs/promises";
import {resolve} from "node:path";

const rawAppUrl = process.env.SHOPIFY_APP_URL;

if (!rawAppUrl) {
  throw new Error(
    "Defina SHOPIFY_APP_URL antes de compilar ou publicar as extens?es.",
  );
}

const appUrl = new URL(rawAppUrl);

if (appUrl.protocol !== "https:") {
  throw new Error("SHOPIFY_APP_URL precisa usar HTTPS.");
}

const normalizedAppUrl = appUrl.origin;
const output = `// Arquivo gerado. N?o edite manualmente.\nexport const APP_URL = ${JSON.stringify(normalizedAppUrl)};\n`;
const targets = [
  "extensions/central-login/src/app-url.js",
  "extensions/indique-e-ganhe/src/app-url.js",
];

await Promise.all(
  targets.map(async (target) => {
    const absolutePath = resolve(target);
    await mkdir(resolve(target, ".."), {recursive: true});
    await writeFile(absolutePath, output, "utf8");
  }),
);

console.log(
  `URL das extens?es configurada para ${normalizedAppUrl}`,
);
