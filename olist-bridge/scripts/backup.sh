#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

backup_dir=${BACKUP_DIR:-"$project_dir/backups"}
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_file="$backup_dir/mibro-$timestamp.sql.gz"

mkdir -p "$backup_dir"

docker compose exec -T db sh -c \
  'pg_dump --clean --if-exists --no-owner -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  | gzip > "$backup_file"

gzip -t "$backup_file"
echo "Backup criado e verificado: $backup_file"
