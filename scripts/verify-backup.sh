#!/usr/bin/env bash
set -euo pipefail

backup_dir="${1:?Usage: ./scripts/verify-backup.sh <backup-directory>}"
test -f "$backup_dir/SHA256SUMS" || { echo "SHA256SUMS is missing." >&2; exit 1; }
(cd "$backup_dir" && sha256sum --check SHA256SUMS)
gzip -t "$backup_dir/database.sql.gz"
tar -tzf "$backup_dir/thumbnails.tar.gz" >/dev/null
echo "Backup verified: $backup_dir"
