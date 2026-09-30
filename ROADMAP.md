# VideoCAT Security And Reliability Roadmap

[Versión en español](ROADMAP.es.md)

This roadmap turns the remaining audit findings into incremental work. It intentionally avoids deadlines: changes should ship only after their compatibility and recovery paths are proven.

## Current Baseline

Completed in September 2026:

- Dependency audit reports no known npm vulnerabilities.
- CI performs a clean install, migrations and tests with temporary PostgreSQL, production dependency audit, typecheck and build.
- Dependabot monitors npm, Docker base images and GitHub Actions.
- Web mutations enforce configured origins and secure response headers.
- JWT algorithms, input sizes, upload types and request times are bounded.
- Companion file operations use canonical paths and collision-safe copies.
- Docker images use Node.js 24, a maintained Nginx release and healthchecks.
- Private vulnerability reporting is documented in `SECURITY.md`.

## Delivery Principles

- Preserve existing databases, thumbnails, categories and companion settings.
- Introduce migrations with backups and a tested rollback path.
- Keep destructive operations explicit, idempotent and auditable.
- Maintain compatibility for one release when replacing tokens or configuration.
- Add tests before changing authentication or file lifecycle behavior.

## Phase 1: Automated Safety Net

Priority: high. This phase should land before architectural security changes.

- [x] Add unit tests for origin validation, JWT verification, PIN hashes, protected paths and shared schemas.
- [x] Add API integration tests for login, agent authentication, categories, queues and scan reconciliation.
- [x] Add companion tests for canonical path containment, monitored roots, download collisions and stalled copies.
- [x] Add a temporary PostgreSQL service to CI and run Prisma migrations in tests.
- [x] Define minimum coverage for security-sensitive modules and block regressions in CI.

Phase completed: the suite covers security, authentication, persisted PIN hashing, paths, transfers, categories, queues and reconciliation. CI runs `npm test` against temporary PostgreSQL and requires at least 90% line, 70% branch and 95% function coverage in the selected sensitive helpers.

Definition of done: authentication, protected folders, queue transitions and destructive path checks have reproducible automated tests on every pull request.

## Phase 2: Companion Pairing And Agent Identity

Priority: high. Resolves the optional local token and shared `AGENT_TOKEN` risks.

- [x] Generate and persist a cryptographically random identity for each companion installation.
- [x] Pair through a short-lived, one-time code (10 minutes, rate-limited per IP).
- [x] Store only hashed agent credentials on the server and protect local secrets with DPAPI (Electron `safeStorage`).
- [x] Give every agent a name, last-seen timestamp, allowed capabilities and revocation controls.
- [x] Replace the shared `AGENT_TOKEN` with per-agent credentials while accepting the legacy token during the transition.
- [ ] Remove legacy `AGENT_TOKEN` authentication once every companion is paired.
- [ ] Require authentication for every companion endpoint other than minimal health discovery. Today `COMPANION_TOKEN` is optional and requests without an `Origin` header bypass the origin check.
- [ ] Evaluate server-mediated, signed action queues for commands initiated from another device. The outbound tunnel already carries streaming orders; open, copy and delete still use the local listener or polling.

Status: pairing, encrypted per-agent credentials, capabilities and revocation have shipped since `v0.1.14` (see [REMOTE_STREAMING_PLAN.md](REMOTE_STREAMING_PLAN.md)). Hardening the local listener and retiring the shared token remain.

Definition of done: an administrator can pair, inspect and revoke one companion without rotating credentials for every other agent, and no destructive local endpoint relies only on browser origin.

## Phase 3: Durable Action Audit

Priority: high for destructive operations.

- [x] Add the append-only `ActionAudit` ledger. It already records file deletion, scan completion, download queue/history cleanup and maintenance pruning.
- [ ] Extend the ledger to copy, queue cancellation, thumbnail repair and catalog removal.
- [x] Record actor, agent, request ID, target, timestamps, outcome and a sanitized error.
- [x] Add idempotency keys for destructive queue cleanup.
- [ ] Extend idempotency keys to every other destructive operation.
- [x] Configurable retention (`ACTION_AUDIT_RETENTION_DAYS`) with administrative cleanup.
- [ ] Provide a searchable, exportable audit tab in the UI.
- [ ] Never store agent secrets or unnecessary absolute personal paths in logs. Needs review: the `scan.finish` target stores the scanned root path.

Definition of done: every physical or catalog-destructive action can be traced from request to final outcome and safely retried.

## Phase 4: Scan Leases And Reconciliation Safety

Priority: medium-high. Protects catalog correctness when scans overlap.

- [x] Allow only one active reconciliation lease per disk and monitored root.
- [x] Add lease owner, generation and expiry fields to scans.
- [x] Renew leases during long scans and recover abandoned leases safely.
- [x] Permit only the newest generation to mark files absent.
- [ ] Add tests for concurrent, interrupted and resumed scans.

Definition of done: an old or interrupted scan cannot hide files reported by a newer scan.

## Phase 5: Non-Root Containers

Priority: medium-high. Requires careful volume migration.

- [x] Run the API as an unprivileged user (`node`) with a read-only root filesystem.
- [x] Run the web image with unprivileged Nginx on an internal high port (`8080`).
- [x] Grant write access only to the thumbnail directory and required temporary paths.
- [x] Drop Linux capabilities, enable `no-new-privileges` and document compatible Portainer settings.
- [x] Support explicit trusted-proxy addresses or CIDRs (`TRUST_PROXY_CIDRS`).
- [ ] Automate and test the ownership migration for existing thumbnail volumes. A manual `chown` is documented in [OPERATIONS.md](OPERATIONS.md).

Definition of done: both application containers run without root, existing installations upgrade without losing thumbnails, and healthchecks continue to pass.

## Phase 6: Ingestion And Query Scalability

Priority: medium.

- [ ] Replace per-file ingestion round trips with bounded transactions and bulk upserts. Ingestion still creates or updates each video individually.
- [x] Add Review indexes.
- [ ] Add indexes based on measured query plans for folders, categories and duplicates.
- [ ] Move expensive facet aggregation into SQL or cached summaries.
- [x] Replace `ORDER BY random()` in Review with indexed UUID-pivot sampling.
- [ ] Apply the same sampling to the random `To download` selection, which still uses `ORDER BY random() LIMIT 2000`.
- [ ] Add representative performance fixtures and budgets for 25k, 100k and 500k files.

Definition of done: scan throughput and primary web queries stay within documented budgets without unbounded memory growth.

## Phase 7: Error Retention And Observability

Priority: medium.

- [x] Define retention separately for agent errors, scan history and action logs (`AGENT_ERROR_RETENTION_DAYS`, `SCAN_RETENTION_DAYS`, `ACTION_AUDIT_RETENTION_DAYS`).
- [x] Administrative cleanup through `POST /api/admin/maintenance/prune`.
- [ ] Add pagination and age/category filters to the audit view.
- [ ] Aggregate repeated errors without losing first/last occurrence and count.
- [ ] Add structured request and correlation IDs across server and companion logs. Only remote streaming correlates `requestId` today.
- [ ] Publish health and queue diagnostics without exposing secrets or file contents. `GET /api/health` only returns `ok`.

Definition of done: diagnostic data remains useful over time while database growth is predictable and controllable.

## Phase 8: Backup And Restore Assurance

Priority: medium, required before declaring production readiness.

- [x] Provide supported backup scripts for PostgreSQL, thumbnails and deployment configuration (`scripts/backup.sh`, `backup.ps1`, `restore.sh`).
- [ ] Encrypt backups that contain file paths or private metadata. The scripts do not encrypt; this is left to the administrator today.
- [x] Document Portainer and plain Docker Compose procedures.
- [x] Add a backup validation command (`scripts/verify-backup.sh`, checksum-based).
- [ ] Add version compatibility checks on restore.
- [x] Produce SBOMs with artifact attestation from the tag workflow.
- [ ] Sign container images in the publishing workflow.
- [ ] Perform and document a clean restore drill before each stable release.

Definition of done: a documented, tested procedure can restore a fresh VideoCAT installation with its database, thumbnails and settings.

## Consolidation Delivered

The September 2026 consolidation adds the `ActionAudit` ledger, idempotency keys for destructive queue cleanup, per disk/root scan leases with generations, batch lease renewal, Review indexes, indexed UUID sampling, configurable retention, backup/verify/restore scripts, SBOM attestation and non-root application containers. See [OPERATIONS.md](OPERATIONS.md) for the operational runbook.

Remaining work is marked in each phase. The most relevant items are mandatory authentication on the companion's local listener, an audit tab in the UI, concurrent-scan tests, bulk ingestion, 100k/500k performance budgets, repeated-error aggregation, backup encryption and a clean restore drill before every stable release.

## Recommended Order

1. Automated safety net.
2. Durable action audit and idempotency foundation.
3. Companion pairing and per-agent credentials.
4. Scan leases and reconciliation safety.
5. Non-root container migration.
6. Ingestion and query scalability.
7. Error retention and observability.
8. Backup and restore automation.

Security reports should follow [SECURITY.md](SECURITY.md). Public implementation work can be tracked through issues and pull requests linked to the relevant phase above.
