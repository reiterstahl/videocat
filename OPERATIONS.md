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

## Upgrading to 0.2.18

- **Traslados** redesigned: summary with the staging folder at the top, a compact "Para continuar" block (drives to connect, space to free, missing staging folder), starred folders as cards with their size, free space and namesakes, and direct **Consolidar** and **Agrupar archivos** buttons. Consolidar and Agrupar now live in two columns with their own colour and their own transfers.
- No migrations or configuration changes; the Windows Companion stays on 0.2.6.

## Upgrading to 0.2.17

- Image hardening after a vulnerability scan of 0.2.16 (Docker Scout / Trivy):
  - Server image moves from Debian 12 (bookworm) to **Debian 13 (trixie)** and installs the latest security updates on every build. Critical findings go from 4 to 0; the remaining ones are Debian advisories without a published fix, in system tools the server does not use.
  - The server image no longer ships `npm`, `npx`, `corepack` or `yarn` (the Node base image bundles them with their own vulnerable dependencies). Migrations run with the Prisma CLI directly. If you ran `npx` inside the container by hand, use `./node_modules/.bin/prisma` instead.
  - Web image applies Alpine security updates on every build.
  - CI scans both images with Trivy and fails on critical or high findings that already have a fix.
- No configuration changes; the Windows Companion stays on 0.2.6.

## Upgrading to 0.2.16

- Transfers: every state change reported by a Companion is now applied atomically against the state and holder it was based on, so a cancel from the web or two Companions at the same moment can never overwrite each other.
- The catalog folder tree has an **Agrupar archivos** shortcut on every folder.
- No migrations or configuration changes; the Windows Companion stays on 0.2.6.

## Upgrading to 0.2.15

- **Agrupar archivos** in Traslados: pick a folder (it gets a star) and decide, file by file like in Review, which files with a similar name on any drive move into it (`F` group, `J` ignore, `Z` undo). Files travel through the Companion staging folder exactly like a consolidation.
- Migration `0022_transfer_group_ignores` runs automatically. No configuration changes; the Windows Companion stays on 0.2.6.

## Upgrading to 0.2.14 (Companion 0.2.6)

- New section **Traslados** (`/traslados`) and **Consolidar** in Uso por carpeta: star the folder that should receive the contents of its namesakes; files move through a local staging folder of the Companion and are only removed from a place after their copy in the next one is verified with SHA-256.
- Migration `0021_transfers` runs automatically when the server starts.
- Windows Companion 0.2.6 (updates itself): set **Configuración › Archivos › Carpeta temporal de traslados** (`COMPANION_STAGING_DIR`). Without it transfers wait; the Companion always leaves 5 % of that drive free. `COMPANION_TRANSFER_POLL_MS` (default 60000) sets how often it checks for transfer work.

## Upgrading to 0.2.13

- New section **Uso por carpeta** (`/uso-por-carpeta`): folders with the same name are merged across drives and levels; exclusions are stored on the server. No configuration changes; the Windows Companion stays on 0.2.5.

## Upgrading to 0.2.12 (Companion 0.2.5)

- Dependency maintenance: nginx 1.31.6, @fastify/multipart, cookie and cors, ws and Vite updates. Prisma stays on 6.12 because 6.13 through 7.x pull a vulnerable deepmerge-ts into the migration CLI.
- Windows Companion 0.2.5 moves to Electron 42.11.12 (Chromium security fixes); installed Companions update themselves.
- No configuration changes.

## Upgrading to 0.2.11 (Companion 0.2.4)

- Fixes Companion heartbeats failing with `400 Invalid uuid` on `mountedDiskIds`. Folders added by hand in the tray had non-UUID ids; the server now accepts them, so those Companions show as online again and their delete and download queues are processed. Deploy the server first: it fixes existing installations without touching the Companion.
- Windows Companion 0.2.4 gives newly added folders real UUIDs. Installed Companions update themselves; existing folders keep their ids and catalog.

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
