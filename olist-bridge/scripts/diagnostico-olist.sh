#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

report=${REPORT:-/tmp/mibro-olist-diagnostico.txt}

{
  echo "========================================"
  echo "MIBRO / OLIST - DIAGNOSTICO"
  echo "Data: $(date -Iseconds)"
  echo "Diretorio: $(pwd)"
  echo "========================================"
  echo

  echo "### GIT"
  git branch --show-current 2>/dev/null || true
  git rev-parse --short HEAD 2>/dev/null || true
  git status --short 2>/dev/null || true
  echo

  echo "### ARQUIVOS DA RAIZ"
  find . -maxdepth 2 -type f \
    ! -path "./node_modules/*" \
    ! -path "./.git/*" \
    ! -path "./build/*" \
    ! -path "./dist/*" \
    | sort
  echo

  echo "### PACKAGE.JSON"
  if [ -f package.json ]; then
    sed -n '1,240p' package.json
  else
    echo "package.json nao encontrado"
  fi
  echo

  echo "### SHOPIFY.APP.TOML"
  if [ -f shopify.app.toml ]; then
    sed -n '1,260p' shopify.app.toml \
      | sed -E 's/(client_id[[:space:]]*=[[:space:]]*).*/\1"OCULTO"/'
  else
    echo "shopify.app.toml nao encontrado"
  fi
  echo

  echo "### DOCKER COMPOSE - SERVICOS"
  docker compose config --services 2>/dev/null || true
  echo

  echo "### VARIAVEIS DISPONIVEIS - SOMENTE NOMES"
  if [ -f .env ]; then
    grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env \
      | cut -d= -f1 \
      | sort
  else
    echo ".env nao encontrado"
  fi
  echo

  echo "### VARIAVEIS DO CONTAINER - SOMENTE NOMES"
  docker compose exec -T app sh -lc '
    printenv |
    cut -d= -f1 |
    grep -E "SHOPIFY|DATABASE|APP|HOST|URL|OLIST|CNPJ" |
    sort
  ' 2>/dev/null || true
  echo

  echo "### ESTRUTURA APP"
  find app -maxdepth 4 -type f 2>/dev/null | sort
  echo

  echo "### ESTRUTURA PRISMA"
  find prisma -maxdepth 3 -type f 2>/dev/null | sort
  echo

  echo "### SCHEMA PRISMA"
  if [ -f prisma/schema.prisma ]; then
    sed -n '1,300p' prisma/schema.prisma
  else
    echo "schema.prisma nao encontrado"
  fi
  echo

  echo "### ROTAS EXISTENTES"
  find app -type f 2>/dev/null \
    | grep -E '/routes/|routes\.' \
    | sort
  echo

  echo "### REFERENCIAS A APP PROXY"
  grep -RIn \
    --exclude-dir=node_modules \
    --exclude-dir=.git \
    --exclude-dir=build \
    --exclude-dir=dist \
    -E 'appProxy|authenticate\.public\.appProxy|/apps/|cnpj-validator|cnpj' \
    app shopify.app.toml 2>/dev/null \
    | head -n 300
  echo

  echo "### VERSOES"
  docker compose exec -T app node --version 2>/dev/null || true
  docker compose exec -T app npm --version 2>/dev/null || true
  docker compose exec -T app npx prisma --version 2>/dev/null || true
} > "$report"

echo
