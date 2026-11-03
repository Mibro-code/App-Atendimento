#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

test -f .env || {
  echo "Arquivo .env ausente. Copie .env.example e preencha os valores." >&2
  exit 1
}

docker compose config --quiet
docker compose pull db caddy
docker compose build --pull app
docker compose up -d --remove-orphans
docker compose ps
