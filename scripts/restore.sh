#!/usr/bin/env bash
set -euo pipefail

# This intentionally requires an explicit confirmation because it replaces data.
backup_dir="${1:?Usage: ./scripts/restore.sh <backup-directory> --confirm}"
test "${2:-}" = "--confirm" || { echo "Refusing to restore without --confirm." >&2; exit 2; }
"$(dirname "$0")/verify-backup.sh" "$backup_dir"

project="${COMPOSE_PROJECT_NAME:-$(basename "$(pwd)")}" 
postgres_container="$(docker compose ps -q postgres)"
test -n "$postgres_container" || { echo "PostgreSQL is not running for this Compose project." >&2; exit 1; }
thumbnail_volume="$(docker volume ls -q --filter "label=com.docker.compose.project=${project}" --filter "label=com.docker.compose.volume=thumbnails_data" | head -n 1)"
test -n "$thumbnail_volume" || { echo "Could not locate thumbnails_data." >&2; exit 1; }

echo "Restoring database and thumbnails from $backup_dir"
gzip -dc "$backup_dir/database.sql.gz" | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-videocat}" -d "${POSTGRES_DB:-videocat}"
docker run --rm -v "${thumbnail_volume}:/target" -v "$(cd "$backup_dir" && pwd):/backup:ro" alpine:3.21 \
  sh -c 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar -C /target -xzf /backup/thumbnails.tar.gz'
echo "Restore completed. Restart the server and web services after verifying the database."
