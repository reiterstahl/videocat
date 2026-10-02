# VideoCAT Server

API server for **VideoCAT**, a private, self-hosted catalog for videos spread across external drives that are rarely all connected at once. It indexes metadata, relative paths, thumbnails, tags, duplicates and review decisions — **original videos never leave your drives**.

![VideoCAT catalog](https://raw.githubusercontent.com/reiterstahl/videocat/main/docs/screenshots/catalog.png)

- Website: https://videocat.centeran.com
- Source code and docs: https://github.com/reiterstahl/videocat
- Windows Companion installer: https://github.com/reiterstahl/videocat/releases/latest/download/VideoCAT-Companion-win-Setup.exe

## What this image runs

`reiterstahl/videocat-server` is the Fastify + Prisma API:

- Applies database migrations on startup, then serves the API on port `4000`.
- Sign-in, catalog, review, duplicate detection, downloads queue, audit and administration endpoints.
- Endpoints and the outbound WebSocket tunnel (`/api/agent/tunnel`) used by paired Windows Companions, including bounded, read-only remote playback.
- Thumbnail uploads (validated JPEG) and serving.

Use it together with [`reiterstahl/videocat-web`](https://hub.docker.com/r/reiterstahl/videocat-web) and `postgres:16-alpine`. The official Compose file wires all three.

## Quick start

Linux, macOS or WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/reiterstahl/videocat/main/install.sh | sh
```

Windows PowerShell with Docker Desktop:

```powershell
powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/reiterstahl/videocat/main/install.ps1 | iex"
```

The installer creates a `videocat` folder, generates every secret in `.env`, prints the admin password and starts the stack. Open http://localhost:8081.

Manual setup:

```bash
mkdir videocat && cd videocat
curl -fsSLO https://raw.githubusercontent.com/reiterstahl/videocat/main/docker-compose.hub.yml
curl -fsSL https://raw.githubusercontent.com/reiterstahl/videocat/main/.env.example -o .env
# Edit .env: replace every "replace-with-…" value (openssl rand -hex 32 for secrets).
docker compose -f docker-compose.hub.yml up -d
```

## Main environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. |
| `JWT_SECRET`, `AGENT_TOKEN` | Secrets; generate each with `openssl rand -hex 32`. |
| `ADMIN_USER`, `ADMIN_PASSWORD` | Web sign-in. |
| `WEB_ORIGIN` | Exact public URL; writes from other origins are rejected. |
| `COOKIE_SECURE` | `true` with HTTPS, `false` only for local testing. |
| `TRUST_PROXY`, `TRUST_PROXY_CIDRS` | Reverse proxy trust, preferably limited to its CIDRs. |
| `PROTECTED_FOLDER_PIN`, `PROTECTED_FOLDER_PATTERNS` | PIN and folder-name fragments to protect. |
| `THUMBNAILS_DIR` | Thumbnail storage, `/data/video-catalog/thumbnails` by default. |
| `REMOTE_REMUX_ENABLED`, `REMOTE_STREAM_*` | Optional MP4 remux and remote playback limits. |
| `AGENT_ERROR_RETENTION_DAYS`, `ACTION_AUDIT_RETENTION_DAYS`, `SCAN_RETENTION_DAYS` | Retention applied by the cleanup in Administration. |

The full commented list is in [`.env.example`](https://github.com/reiterstahl/videocat/blob/main/.env.example).

## Volumes and permissions

Thumbnails live in `/data/video-catalog/thumbnails`, mounted by Compose as the `thumbnails_data` volume. The container runs as the non-root user `node` (uid 1000); the official Compose file also makes its root file system read-only and drops all capabilities. Volumes created by releases before 0.2.0 (which ran as root) are handed to uid 1000 automatically by the one-shot `thumbnails-init` service in the official Compose file. If you run the image without it and uploads answer `507`, run `chown -R 1000:1000` on the volume once.

## Tags and platforms

- `0.2.3`, `0.2.2`, … — versioned, stable tags. Prefer them for predictable deployments.
- `latest` — the newest published release.

Images are built for `linux/amd64` and `linux/arm64`.

## Updating and backups

Set `VIDEOCAT_VERSION` in `.env` (or use `latest`), then:

```bash
docker compose -f docker-compose.hub.yml pull
docker compose -f docker-compose.hub.yml up -d
```

Back up PostgreSQL, the `thumbnails_data` volume and `.env`. The repository includes `scripts/backup.sh`, `verify-backup.sh` and `restore.sh`; see [OPERATIONS.md](https://github.com/reiterstahl/videocat/blob/main/OPERATIONS.md).

## Security notes

- Use HTTPS, `COOKIE_SECURE=true` and an exact `WEB_ORIGIN` outside localhost, and expose only the `web` container.
- Each Companion pairs with a one-time code and an individual, revocable credential; the server stores only its hash.
- Original videos are never stored on the server. Physical deletion only happens on Windows, by the Companion, with the right drive connected and the file revalidated.
- Report vulnerabilities privately: https://github.com/reiterstahl/videocat/security

## License

Free and open source software under `AGPL-3.0-or-later`.
