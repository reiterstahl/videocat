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

## October 2026 Node.js security release

The server and build images install Node 24.22.1 from the official archive and
verify its SHA-256 checksum. `.nvmrc` and CI select the same release. The
temporary installer is needed because the exact patched Docker tags currently
have empty platform manifests.

Companion uses the supported Electron 43 branch. Electron 43.8.3 still embeds
Node 24.22.0, so it does **not** contain the October 21 Node fixes. New Electron
packages are blocked by `npm run check:node-security -w @videocat/agent-windows`
until an Electron release with a corrected runtime is selected. The check runs
Electron in Node mode and verifies the embedded version; updating the host's
Node does not satisfy it. Existing Windows installations remain pending an
upstream fix, rebuilt packages and redistribution.

The experimental SEA build also verifies its build runtime before copying it
into the executable. Run it with the Node version in `.nvmrc`.

Advisory: https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
