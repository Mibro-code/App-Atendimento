import {spawnSync} from "node:child_process";

const TARGETS = {
  mibro: {
    config: "shopify.app.toml",
    appUrl: "https://app.mibrobrasil.com.br",
  },
  sincrofit: {
    config: "sincrofit",
    appUrl: "https://app.sincrofit.com.br",
  },
};

const [command, targetName] = process.argv.slice(2);
const target = TARGETS[targetName];

if (!["build", "deploy"].includes(command) || !target) {
  console.error(
    "Uso: node scripts/shopify-target.mjs <build|deploy> <mibro|sincrofit>",
  );
  process.exit(1);
}

function run(executable, args, env) {
  const useShell =
    process.platform === "win32" &&
    executable.toLowerCase().endsWith(".cmd");

  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    shell: useShell,
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

function configureExtensions(appUrl) {
  return run(
    process.execPath,
    ["scripts/configure-extensions.mjs"],
    {
      ...process.env,
      SHOPIFY_APP_URL: appUrl,
    },
  );
}

const canonicalAppUrl = TARGETS.mibro.appUrl;
let exitCode = 1;

try {
  if (configureExtensions(target.appUrl) !== 0) {
    throw new Error(
      "Nao foi possivel configurar as URLs das extensoes.",
    );
  }

  const shopifyExecutable =
    process.platform === "win32" ? "shopify.cmd" : "shopify";

  exitCode = run(
    shopifyExecutable,
    ["app", command, "--config", target.config],
    {
      ...process.env,
      SHOPIFY_APP_URL: target.appUrl,
    },
  );
} catch (error) {
  console.error(error.message || error);
  exitCode = 1;
} finally {
  const restoreStatus = configureExtensions(canonicalAppUrl);

  if (restoreStatus !== 0) {
    console.error(
      "ATENCAO: nao foi possivel restaurar a URL canonica da Mibro.",
    );
    exitCode = 1;
  }
}

process.exit(exitCode);
