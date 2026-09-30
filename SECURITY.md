# Security Policy

## Supported versions

Security fixes are applied to the latest release of VideoCAT. Before reporting a problem, confirm that it is still reproducible with the latest server, web image and Windows Companion.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting for this repository:

https://github.com/reiterstahl/videocat/security/advisories/new

Include the affected component and version, deployment topology, reproduction steps, expected impact and any relevant logs with secrets and personal file paths removed. You should receive an initial response within seven days.

## Deployment baseline

- Use unique random values for `POSTGRES_PASSWORD`, `JWT_SECRET`, `AGENT_TOKEN` and `ADMIN_PASSWORD`.
- Keep the API port bound to `127.0.0.1` and publish only the web reverse proxy.
- Use HTTPS with `COOKIE_SECURE=true` for every non-local deployment.
- Set `WEB_ORIGIN` to the exact origins that serve the VideoCAT interface.
- On each Windows Companion (tray settings or `apps/agent-windows/.env`, not the server `.env`), configure `COMPANION_ALLOWED_ORIGINS` narrowly. `COMPANION_TOKEN` is mandatory since 0.2.0: the tray app generates it when missing, every local action requires it, and each browser stores it from Profile › Local Companion. See `apps/agent-windows/.env.example`.
- Back up PostgreSQL and thumbnails before upgrades.
