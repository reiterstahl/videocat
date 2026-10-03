# VideoCAT Web

Web interface for **VideoCAT**, a private, self-hosted catalog for videos spread across external drives that are rarely all connected at once. Search your whole collection, review videos, find likely duplicates, queue copies, play remotely from your phone and free up space — **original videos never leave your drives**.

![VideoCAT catalog](https://raw.githubusercontent.com/reiterstahl/videocat/main/docs/screenshots/en/catalog.webp)

- Website: https://videocat.centeran.com
- Source code and docs: https://github.com/reiterstahl/videocat
- Windows Companion installer: https://github.com/reiterstahl/videocat/releases/latest/download/VideoCAT-Companion-win-Setup.exe

| Review | Assisted duplicates |
| --- | --- |
| ![Review session](https://raw.githubusercontent.com/reiterstahl/videocat/main/docs/screenshots/en/review.webp) | ![Assisted duplicates](https://raw.githubusercontent.com/reiterstahl/videocat/main/docs/screenshots/en/duplicates.webp) |

## What this image runs

`reiterstahl/videocat-web` is the React app served by unprivileged Nginx on port `8080`:

- The VideoCAT interface in Spanish and English, responsive for desktop and phones, with light, dark and OLED themes.
- An installable web app (PWA) for Chrome, Edge, Firefox on Windows and Android, and Safari on iPhone, iPad and macOS. Its service worker caches only the app shell — never API responses, thumbnails or videos — and offers updates when a new image is deployed. Installing requires HTTPS.
- A proxy for `/api/*` and `/thumbnails/*` to the `server` container, including the WebSocket used by the Companion tunnel.
- Security headers (CSP, HSTS under HTTPS) and SPA routing.

Use it together with [`reiterstahl/videocat-server`](https://hub.docker.com/r/reiterstahl/videocat-server) and `postgres:16-alpine`. The official Compose file wires all three.

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

## Ports and reverse proxy

The container listens on `8080`; the official Compose file publishes it on `${WEB_BIND_ADDR:-0.0.0.0}:${WEB_PUBLISHED_PORT:-8081}`.

Publish only this container through your reverse proxy. It forwards `/api/*` and `/thumbnails/*` to `server:4000` itself. Your proxy must allow WebSocket upgrades (`Upgrade` and `Connection` headers) for `/api/agent/tunnel`. With HTTPS, set `WEB_ORIGIN=https://your-domain.example`, `COOKIE_SECURE=true` and `TRUST_PROXY=true`. A complete Nginx example is in the [README](https://github.com/reiterstahl/videocat#reverse-proxy).

## Windows Companion

The Companion is a Windows tray app that detects drives (even when their letter changes), scans them with FFmpeg, uploads metadata and thumbnails, processes deletions and downloads, and serves remote playback through an outbound tunnel — no open ports on your PC.

Install it with [VideoCAT-Companion-win-Setup.exe](https://github.com/reiterstahl/videocat/releases/latest/download/VideoCAT-Companion-win-Setup.exe). It installs per user without administrator rights and updates itself from GitHub Releases. Pair it from **Administration › Companions** with a one-time code.

## Tags and platforms

- `0.2.7`, `0.2.6`, … — versioned, stable tags. Prefer them for predictable deployments.
- `latest` — the newest published release.

Images are built for `linux/amd64` and `linux/arm64`. The interface shows a notice when a newer stable version is published here.

## Security notes

- Use HTTPS outside localhost and expose only this container.
- The container runs as a non-root user; the official Compose file also makes its root file system read-only and drops all capabilities.
- Original videos are never stored on the server. Physical deletion only happens on Windows, by the Companion, with the right drive connected and the file revalidated.
- Report vulnerabilities privately: https://github.com/reiterstahl/videocat/security

## License

Free and open source software under `AGPL-3.0-or-later`.
