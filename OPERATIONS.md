# VideoCAT Operations Runbook

This runbook covers normal Docker Compose and Portainer deployments. Backups contain private metadata and paths: store them in an encrypted location controlled by the administrator.

## Upgrade

1. Create and verify a backup before changing the stack.
2. Set `VIDEOCAT_VERSION` to a versioned image tag, or use `latest` only when intentionally tracking current releases.
3. In Portainer, pull and redeploy the stack. Prisma migrations run before the API starts.
4. Confirm `GET /api/health` is healthy and open the web application.

The runtime uses non-root application containers. Fresh thumbnail volumes receive the correct ownership automatically. If an existing `thumbnails_data` volume cannot be written after upgrade, run once from the stack directory:

```bash
docker run --rm -v "$(docker volume ls -q --filter label=com.docker.compose.project=${COMPOSE_PROJECT_NAME:-videocat} --filter label=com.docker.compose.volume=thumbnails_data | head -n1)":/data alpine:3.21 chown -R 1000:1000 /data
```

## Backup

```bash
./scripts/backup.sh
./scripts/verify-backup.sh ./backups/videocat-YYYYMMDDTHHMMSSZ
```

PowerShell:

```powershell
.\scripts\backup.ps1
```

The backup includes a PostgreSQL dump, `thumbnails_data`, checksums and `.env` when it exists. Protect the generated directory with filesystem permissions and encryption. Do not commit it.

## Restore Drill

Restoration replaces database contents and thumbnail files. Test it first in a separate Compose project:

```bash
./scripts/restore.sh ./backups/videocat-YYYYMMDDTHHMMSSZ --confirm
```

Restart the server and web services after a successful restore.

## Proxy And Retention

- Set `TRUST_PROXY_CIDRS` to the reverse proxy IP or CIDR whenever possible, for example `172.16.0.0/12,192.168.1.30`.
- Keep `COOKIE_SECURE=true` for HTTPS deployments.
- Retention is configured by `AGENT_ERROR_RETENTION_DAYS`, `ACTION_AUDIT_RETENTION_DAYS` and `SCAN_RETENTION_DAYS`.
- Invoke `POST /api/admin/maintenance/prune` as an authenticated administrator to remove eligible historical records. It never deletes catalogued videos or thumbnails.

## Release Evidence

Tags run the SBOM workflow and attach a GitHub artifact attestation. Docker image signing requires a configured publishing workflow and registry credentials; until then, use immutable version tags and verify the Companion SHA-256 release asset.
