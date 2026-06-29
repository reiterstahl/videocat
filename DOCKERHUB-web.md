# VideoCAT Web

Nginx-served React web interface for VideoCAT, a private video catalog for external hard drives.

VideoCAT indexes metadata, paths, thumbnails, tags, duplicates and review decisions without copying original videos to the server. It is designed for collections spread across many drives that are not always connected.

Project website: https://videocat.centeran.com  
Source code: https://github.com/reiterstahl/videocat  
Windows Companion: https://github.com/reiterstahl/videocat/releases/latest

## What This Image Does

`reiterstahl/videocat-web` serves:

- The React/Vite VideoCAT interface.
- Static web assets through Nginx.
- `/api/*` proxy to the `server` container.
- `/thumbnails/*` proxy to the `server` container.
- Security headers and SPA routing.

This image should be used together with:

```text
reiterstahl/videocat-server
postgres:16-alpine
```

The easiest way to run the complete stack is the official Compose installer.

## Quick Start

Linux/macOS/WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/reiterstahl/videocat/main/install.sh | sh
```

Windows PowerShell with Docker Desktop:

```powershell
powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/reiterstahl/videocat/main/install.ps1 | iex"
```

Then open:

```text
http://localhost:8081
```

## Compose

Manual setup:

```bash
mkdir videocat
cd videocat
curl -fsSLO https://raw.githubusercontent.com/reiterstahl/videocat/main/docker-compose.hub.yml
curl -fsSLO https://raw.githubusercontent.com/reiterstahl/videocat/main/.env.example
mv .env.example .env
docker compose -f docker-compose.hub.yml up -d
```

## Ports

The web container listens on port `80`.

The official Compose file publishes it as:

```text
http://localhost:8081
```

Relevant Compose variables:

```env
WEB_BIND_ADDR=0.0.0.0
WEB_PUBLISHED_PORT=8081
```

## Reverse Proxy

Publish the `web` container to your reverse proxy. The web container internally proxies:

```text
/api/*         -> server:4000
/thumbnails/* -> server:4000
```

Example production variables:

```env
WEB_ORIGIN=https://your-domain.example
COOKIE_SECURE=true
TRUST_PROXY=true
```

## Tags

Versioned tags are stable:

```text
reiterstahl/videocat-web:0.1.0
```

`latest` points to the newest published build:

```text
reiterstahl/videocat-web:latest
```

For predictable deployments, prefer a versioned tag.

## Windows Companion

The Windows Companion is a tray app that detects drives, scans files, opens local videos, processes pending deletes and handles download queues.

Download it from GitHub Releases:

```text
https://github.com/reiterstahl/videocat/releases/latest
```

## Security Notes

- Use HTTPS and `COOKIE_SECURE=true` outside localhost.
- Keep `AGENT_TOKEN` private.
- Original videos are not uploaded to the server.
- Physical deletion only happens through the Windows Companion when the correct drive is connected.

## License

VideoCAT is free and open source software under `AGPL-3.0-or-later`.
