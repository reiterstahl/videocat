# VideoCAT Operations Runbook

This runbook covers normal Docker Compose and Portainer deployments. Backups contain private metadata and paths: store them in an encrypted location controlled by the administrator.

## Upgrade

1. Create and verify a backup before changing the stack.
2. Set `VIDEOCAT_VERSION` to a versioned image tag, or use `latest` only when intentionally tracking current releases.
3. In Portainer, pull and redeploy the stack. Prisma migrations run before the API starts.
4. Confirm `GET /api/health` is healthy and open the web application.

The runtime uses non-root application containers. A one-shot `thumbnails-init` service in both Compose files hands an existing `thumbnails_data` volume (created by root-run releases before 0.2.0) to uid 1000 before the API starts, so no manual step is needed. If you run the server without Compose and thumbnail uploads answer `507 Thumbnail storage is not writable`, run once from the stack directory:

```bash
docker run --rm -v "$(docker volume ls -q --filter label=com.docker.compose.project=${COMPOSE_PROJECT_NAME:-videocat} --filter label=com.docker.compose.volume=thumbnails_data | head -n1)":/data alpine:3.21 chown -R 1000:1000 /data
```

The API also logs `THUMBNAILS_DIR ... is not writable` at startup when the volume has the wrong owner.

## Upgrading to 0.2.10

- Review shows vertical videos whole: a vertical canvas on phones, a blurred fill instead of black bars, and 9:16 gallery tiles. No configuration changes.

## Upgrading to 0.2.9

- The "new version" prompt of the installed app always reloads into the new version. If an older prompt does nothing, close every VideoCAT window and tab and open it again. No configuration changes.

## Upgrading to 0.2.8

- Review shortcuts changed: `Space` now toggles a privacy mode (black screen, decisions disabled) and `Enter` plays the frames. Decisions show a short confirmation at every screen size. No configuration changes; the Windows Companion stays on 0.2.3.

## Upgrading to 0.2.7

- VideoCAT is now an installable web app (PWA). Browsers only offer installation over HTTPS (or `localhost`); keep the reverse proxy forwarding every path to the `web` container so `/sw.js` and `/manifest.webmanifest` are served with their own cache headers.
- Security fix in the `web` image: the HTML and static files were served without CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` and HSTS because nginx drops server-level headers in locations that set their own. Every route now sends them. If your reverse proxy adds its own CSP, make sure it allows `worker-src 'self'` and `manifest-src 'self'`.
- No configuration changes; the Windows Companion stays on 0.2.3.

## Upgrading to 0.2.6

- Security update: `@fastify/busboy` 3.2.2 fixes a high-severity denial of service through malformed multipart uploads (GHSA-xjh9-v7x6-24jw, GHSA-x8mw-p69m-v3mx), and `fastify` 5.12.5 / `fast-uri` fix two moderate advisories. Upgrade from 0.2.5 or earlier; no configuration changes.

## Upgrading to 0.2.5

- On phones and tablets, the fullscreen frame gallery (Review and file detail) moves between frames with horizontal swipes. No configuration changes; the Windows Companion stays on 0.2.3.

## Upgrading to 0.2.4

- The Duplicates badge in the menu now counts only groups that still need a decision (two or more copies not marked for deletion), using the same detection as the Duplicates view. No configuration changes; the Windows Companion stays on 0.2.3.

## Upgrading to 0.2.3

- Docker stack: the mobile Review confirms each decision with a short animation, keeps the file name pinned at the top and returns to the top after every decision. No configuration changes.
- The Windows Companion now ships as `VideoCAT-Companion-win-Setup.exe` and updates itself from GitHub Releases. On each PC, close the portable `.exe` (0.2.2 or earlier), run Setup.exe once and delete the portable file; settings and pairing in `%APPDATA%\VideoCAT Companion` are kept.

## Upgrading to 0.2.2

- Review shortcuts changed: `F` keeps, `J` marks for deletion and `P` toggles full screen.
- Install Windows Companion 0.2.2 for the paged settings window.

## Upgrading to 0.2.1

- Update the stack's Compose file from `docker-compose.hub.yml`: it adds the one-shot `thumbnails-init` service that repairs thumbnail uploads failing after 0.2.0 on existing volumes.
- Install Windows Companion 0.2.1 for the redesigned settings window and clearer upload error logs.

## Upgrading to 0.2.0

- Install Windows Companion 0.2.0 on every PC. On first start it generates `COMPANION_TOKEN` if none exists.
- Open the Companion settings, use **Copiar token** and paste it in VideoCAT › Profile › Local Companion in each browser that opens, copies or deletes files on that PC. Until then, those local actions answer "token missing or invalid"; remote playback, scans and queues through the server keep working.
- Theme, density and language preferences are stored per browser; earlier light/dark choices are kept.

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
