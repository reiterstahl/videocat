#!/usr/bin/env bash
set -euo pipefail

# Creates a portable backup of PostgreSQL, thumbnails and the local .env file.
# Usage: ./scripts/backup.sh [destination-directory]
destination_root="${1:-./backups}"
project="${COMPOSE_PROJECT_NAME:-$(basename "$(pwd)")}" 
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="${destination_root%/}/videocat-${timestamp}"

command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
mkdir -p "$destination"

postgres_container="$(docker compose ps -q postgres)"
test -n "$postgres_container" || { echo "PostgreSQL is not running for this Compose project." >&2; exit 1; }
thumbnail_volume="$(docker volume ls -q --filter "label=com.docker.compose.project=${project}" --filter "label=com.docker.compose.volume=thumbnails_data" | head -n 1)"
test -n "$thumbnail_volume" || { echo "Could not locate the thumbnails_data volume for project ${project}." >&2; exit 1; }

docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-videocat}" -d "${POSTGRES_DB:-videocat}" | gzip -9 > "$destination/database.sql.gz"
docker run --rm -v "${thumbnail_volume}:/source:ro" -v "$(cd "$destination" && pwd):/backup" alpine:3.21 \
  tar -C /source -czf /backup/thumbnails.tar.gz .

if [[ -f .env ]]; then
  cp .env "$destination/.env"
  chmod 600 "$destination/.env"
fi

cat > "$destination/manifest.txt" <<EOF
VideoCAT backup
created_at_utc=${timestamp}
compose_project=${project}
database=${POSTGRES_DB:-videocat}
EOF
(cd "$destination" && sha256sum database.sql.gz thumbnails.tar.gz .env 2>/dev/null > SHA256SUMS || sha256sum database.sql.gz thumbnails.tar.gz > SHA256SUMS)
echo "Backup created: $destination"
