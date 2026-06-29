# VideoCAT Server

Fastify + Prisma API server for VideoCAT, a private video catalog for external hard drives.

VideoCAT indexes metadata, paths, thumbnails, tags, duplicates and review decisions without copying original videos to the server. It is designed for collections spread across many drives that are not always connected.

Project website: https://videocat.centeran.com  
Source code: https://github.com/reiterstahl/videocat  
Windows Companion: https://github.com/reiterstahl/videocat/releases/latest

## What This Image Does

`reiterstahl/videocat-server` runs:

- Fastify API.
- Prisma migrations on startup.
- Authentication and session cookies.
- Catalog, review, duplicate, audit and admin endpoints.
- Agent endpoints used by the Windows Companion.
- Thumbnail upload and thumbnail serving.

This image should be used together with:

```text
reiterstahl/videocat-web
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

## Required Environment

Important variables for the server container:

```env
DATABASE_URL=postgresql://videocat:strong-password@postgres:5432/videocat
JWT_SECRET=replace-with-64-hex-random-characters
AGENT_TOKEN=replace-with-64-hex-random-characters
ADMIN_USER=admin
ADMIN_PASSWORD=replace-with-a-long-unique-password
WEB_ORIGIN=http://localhost:8081
COOKIE_SECURE=false
TRUST_PROXY=true
PROTECTED_FOLDER_PIN=replace-with-a-private-4-digit-pin
PROTECTED_FOLDER_PATTERNS=Private,Protected
THUMBNAILS_DIR=/data/video-catalog/thumbnails
PUBLIC_THUMBNAILS_BASE_URL=/thumbnails
```

For public HTTPS deployments:

```env
WEB_ORIGIN=https://your-domain.example
COOKIE_SECURE=true
TRUST_PROXY=true
```

## Volumes

The server stores thumbnails in:

```text
/data/video-catalog/thumbnails
```

The official Compose file mounts this as:

```text
thumbnails_data
```

Back up this volume together with PostgreSQL.

## Tags

Versioned tags are stable:

```text
reiterstahl/videocat-server:0.1.0
```

`latest` points to the newest published build:

```text
reiterstahl/videocat-server:latest
```

For predictable deployments, prefer a versioned tag.

## Backup

Database backup example:

```bash
docker compose -f docker-compose.hub.yml exec postgres pg_dump -U videocat videocat > videocat.sql
```

Also back up:

- `.env`
- `postgres_data`
- `thumbnails_data`

## Security Notes

- Change every generated secret before exposing VideoCAT publicly.
- Keep `AGENT_TOKEN` private.
- Use HTTPS and `COOKIE_SECURE=true` outside localhost.
- Original videos are not uploaded to the server.
- Physical deletion only happens through the Windows Companion when the correct drive is connected.

## License

VideoCAT is free and open source software under `AGPL-3.0-or-later`.
