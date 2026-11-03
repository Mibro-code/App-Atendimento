#!/usr/bin/env bash
set -euo pipefail
cd /opt/atendimento/mibro
test "$(git rev-parse HEAD)" = "522f12de71ad6749a810985c928516745b37f3ff"
test -z "$(git status --porcelain --untracked-files=no)"
git apply --check /tmp/bots-v03413.patch
docker image tag "$(docker inspect mibro-atendimento-app-1 --format '{{.Image}}')" mibro-atendimento-app:pre-bots-v03413
docker inspect mibro-atendimento-app-1 --format '{{json .Mounts}}' > /tmp/bots-v03413-mounts-before.json
docker inspect mibro-atendimento-database-1 --format '{{.Id}}' > /tmp/bots-v03413-db-before.txt
backup_stamp="${1:?Informe o backup validado e copiado para o PC}"
[[ "$backup_stamp" =~ ^pre-bots-v03413-[0-9]{8}T[0-9]{6}Z$ ]]
test -s "backups/$backup_stamp.dump"
(cd backups; sha256sum -c "$backup_stamp.sha256")
git am /tmp/bots-v03413.patch
docker compose -f compose.vps.yml build app
printf 'BUILD_COMPLETE\n'
docker compose -f compose.vps.yml up -d --no-deps app
for attempt in $(seq 1 24); do
  status="$(docker inspect mibro-atendimento-app-1 --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}')"
  if [ "$status" = healthy ]; then break; fi
  if [ "$status" = unhealthy ]; then echo 'APP_UNHEALTHY'; exit 1; fi
  sleep 5
done
test "$(docker inspect mibro-atendimento-app-1 --format '{{.State.Health.Status}}')" = healthy
docker inspect mibro-atendimento-app-1 --format '{{json .Mounts}}' > /tmp/bots-v03413-mounts-after.json
docker inspect mibro-atendimento-database-1 --format '{{.Id}}' > /tmp/bots-v03413-db-after.txt
cmp /tmp/bots-v03413-mounts-before.json /tmp/bots-v03413-mounts-after.json
cmp /tmp/bots-v03413-db-before.txt /tmp/bots-v03413-db-after.txt
docker exec mibro-atendimento-app-1 node -e 'const fs=require("fs");if(!fs.readFileSync("public/js/changelog.js","utf8").includes("0.34.13"))process.exit(1);fetch("http://127.0.0.1:3000/health").then(r=>{console.log("HEALTH_HTTP="+r.status);if(!r.ok)process.exit(1)})'
docker exec -i mibro-atendimento-database-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' <<'SQL'
SELECT row_to_json(counts) FROM (SELECT (SELECT count(*) FROM "Contact") AS contacts, (SELECT count(*) FROM "Conversation") AS conversations, (SELECT count(*) FROM "Message") AS messages, (SELECT count(*) FROM "Bot") AS bots) counts;
SELECT json_agg(row_to_json(state)) FROM (SELECT "name","status","autoReplyEnabled","executionMode" FROM "Bot" ORDER BY "id") state;
SQL
git rev-parse HEAD
printf 'DEPLOY_COMPLETE\n'
