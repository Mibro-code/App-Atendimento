#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

VERSION="${1:-}"
TITLE="${2:-}"

if [ -z "$VERSION" ] || [ -z "$TITLE" ]; then
  echo
  echo "Uso:"
  echo '  ./release.sh 0.10.2 "Título da atualização" "Mudança 1" "Mudança 2" ...'
  echo
  exit 1
fi

shift 2
CHANGES=("$@")

if [ "${#CHANGES[@]}" -eq 0 ]; then
  echo "Informe pelo menos uma alteração para o changelog."
  exit 1
fi

echo
echo "======================================"
echo " Mibro Atendimento - Release v$VERSION"
echo "======================================"
echo
echo "Título: $TITLE"
echo
echo "Alterações:"

for CHANGE in "${CHANGES[@]}"; do
  echo " - $CHANGE"
done

echo
echo "Atualizando versão e changelog..."

docker compose -f compose.vps.yml run --rm --no-deps \
  -v "$PWD/public:/app/public" \
  app node - "$VERSION" "$TITLE" "${CHANGES[@]}" <<'NODE'
const fs = require("fs");

const [, , version, title, ...changes] = process.argv;

function escapeJs(value) {
  return JSON.stringify(String(value));
}

const today = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
}).format(new Date());

/* changelog.js */
const changelogPath = "/app/public/js/changelog.js";

let changelog = fs.readFileSync(changelogPath, "utf8");

changelog = changelog.replace(
  /const APP_VERSION = "[0-9]+\.[0-9]+\.[0-9]+";/,
  `const APP_VERSION = "${version}";`
);

const changesText = changes
  .map((change) => `        ${escapeJs(change)}`)
  .join(",\n");

const releaseBlock = `    {
      version: ${escapeJs(version)},
      date: ${escapeJs(today)},
      title: ${escapeJs(title)},
      changes: [
${changesText}
      ]
    },
`;

const marker = "  const CHANGELOG = [";

if (!changelog.includes(marker)) {
  throw new Error("Não foi possível localizar CHANGELOG em changelog.js");
}

const alreadyExists = new RegExp(
  `version:\\s*["']${version.replace(/\./g, "\\.")}["']`
).test(changelog);

if (!alreadyExists) {
  changelog = changelog.replace(
    marker,
    `${marker}\n${releaseBlock}`
  );
}

fs.writeFileSync(changelogPath, changelog);

/* service-worker.js */
const swPath = "/app/public/service-worker.js";
let sw = fs.readFileSync(swPath, "utf8");

sw = sw.replace(
  /const APP_VERSION = "[0-9]+\.[0-9]+\.[0-9]+";/,
  `const APP_VERSION = "${version}";`
);

fs.writeFileSync(swPath, sw);

/* index.html */
const htmlPath = "/app/public/index.html";
let html = fs.readFileSync(htmlPath, "utf8");

html = html.replace(
  /(<span id="app-version-label">)v[0-9]+\.[0-9]+\.[0-9]+(<\/span>)/,
  `$1v${version}$2`
);

html = html.replace(
  /(<strong id="changelog-current-version">)v[0-9]+\.[0-9]+\.[0-9]+(<\/strong>)/,
  `$1v${version}$2`
);

fs.writeFileSync(htmlPath, html);

console.log(`Arquivos atualizados para v${version}`);
NODE

echo
echo "Confirmando versão..."

grep -n "APP_VERSION" public/js/changelog.js
grep -n "APP_VERSION" public/service-worker.js
grep -n "app-version-label\|changelog-current-version" public/index.html

echo
echo "Validando JavaScript..."

for FILE in \
  public/js/app.js \
  public/js/changelog.js \
  public/js/internal-chat.js \
  public/js/pwa.js \
  public/service-worker.js
do
  echo "  -> $FILE"

  docker compose -f compose.vps.yml run --rm --no-deps \
    -v "$PWD/public:/app/public" \
    app node --check "$FILE"
done

echo
echo "Construindo nova imagem..."

docker compose -f compose.vps.yml build app

echo
echo "Subindo aplicação..."

docker compose -f compose.vps.yml up -d app

echo
echo "Aguardando healthcheck..."

for i in $(seq 1 20); do
  STATUS="$(
    docker inspect \
      --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
      mibro-atendimento-app-1 \
      2>/dev/null || true
  )"

  echo "  status: ${STATUS:-aguardando}"

  if [ "$STATUS" = "healthy" ]; then
    break
  fi

  if [ "$STATUS" = "unhealthy" ]; then
    echo
    echo "ERRO: aplicação ficou unhealthy."
    docker compose -f compose.vps.yml logs --tail=100 app
    exit 1
  fi

  sleep 2
done

FINAL_STATUS="$(
  docker inspect \
    --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    mibro-atendimento-app-1
)"

if [ "$FINAL_STATUS" != "healthy" ]; then
  echo
  echo "A aplicação não ficou healthy no tempo esperado."
  docker compose -f compose.vps.yml logs --tail=100 app
  exit 1
fi

echo
docker compose -f compose.vps.yml ps

echo
echo "Últimos logs:"
docker compose -f compose.vps.yml logs --tail=25 app

echo
echo "======================================"
echo " v$VERSION publicada com sucesso."
echo "======================================"
