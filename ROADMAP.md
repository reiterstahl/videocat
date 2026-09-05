# VideoCAT Security And Reliability Roadmap

[Versión en español](ROADMAP.es.md)

This roadmap turns the remaining audit findings into incremental work. It intentionally avoids deadlines: changes should ship only after their compatibility and recovery paths are proven.

## Current Baseline

Completed in September 2026:

- Dependency audit reports no known npm vulnerabilities.
- CI performs a clean install, production dependency audit, typecheck and build.
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

- [ ] Add unit tests for origin validation, JWT verification, PIN hashes, protected paths and shared schemas.
- [ ] Add API integration tests for login, agent authentication, categories, queues and scan reconciliation.
- [ ] Add companion tests for canonical path containment, monitored roots, download collisions and stalled copies.
- [ ] Add a temporary PostgreSQL service to CI and run Prisma migrations in tests.
- [ ] Define minimum coverage for security-sensitive modules and block regressions in CI.

Definition of done: authentication, protected folders, queue transitions and destructive path checks have reproducible automated tests on every pull request.

## Phase 2: Companion Pairing And Agent Identity

Priority: high. Resolves the optional local token and shared `AGENT_TOKEN` risks.

- [ ] Generate a cryptographically random identity for each companion installation.
- [ ] Add a short-lived, one-time pairing code displayed by the companion.
- [ ] Store only hashed agent credentials on the server and protect local secrets with Windows Credential Manager or DPAPI.
- [ ] Give every agent a name, last-seen timestamp, allowed capabilities and revocation controls.
- [ ] Replace the shared `AGENT_TOKEN` with per-agent credentials while accepting the legacy token for one transition release.
- [ ] Require authentication for every companion endpoint other than minimal health discovery.
- [ ] Evaluate server-mediated, signed action queues for commands initiated from another device.

Definition of done: an administrator can pair, inspect and revoke one companion without rotating credentials for every other agent, and no destructive local endpoint relies only on browser origin.

## Phase 3: Durable Action Audit

Priority: high for destructive operations.

- [ ] Add an append-only action ledger for delete, copy, queue cancellation, thumbnail repair and catalog removal.
- [ ] Record actor, agent, request ID, target, timestamps, outcome and a sanitized error.
- [ ] Add idempotency keys so retries cannot execute a destructive operation twice.
- [ ] Provide searchable audit views and retention/export controls.
- [ ] Never store agent secrets or unnecessary absolute personal paths in logs.

Definition of done: every physical or catalog-destructive action can be traced from request to final outcome and safely retried.

## Phase 4: Scan Leases And Reconciliation Safety

Priority: medium-high. Protects catalog correctness when scans overlap.

- [ ] Allow only one active reconciliation lease per disk and monitored root.
- [ ] Add lease owner, generation and expiry fields to scans.
- [ ] Renew leases during long scans and recover abandoned leases safely.
- [ ] Permit only the newest successful generation to mark files absent.
- [ ] Add tests for concurrent, interrupted and resumed scans.

Definition of done: an old or interrupted scan cannot hide files reported by a newer scan.

## Phase 5: Non-Root Containers

Priority: medium-high. Requires careful volume migration.

- [ ] Run the API as an unprivileged user with a read-only root filesystem where practical.
- [ ] Run the web image with unprivileged Nginx on an internal high port.
- [ ] Grant write access only to the thumbnail directory and required temporary paths.
- [ ] Drop Linux capabilities, enable `no-new-privileges` and document compatible Portainer settings.
- [ ] Support explicit trusted-proxy addresses or CIDRs so direct clients cannot spoof forwarded IP headers.
- [ ] Provide and test a one-time ownership migration for existing thumbnail volumes.

Definition of done: both application containers run without root, existing installations upgrade without losing thumbnails, and healthchecks continue to pass.

## Phase 6: Ingestion And Query Scalability

Priority: medium.

- [ ] Replace per-file ingestion round trips with bounded transactions and bulk upserts.
- [ ] Add indexes based on measured query plans for review, folders, categories and duplicates.
- [ ] Move expensive facet aggregation into SQL or cached summaries.
- [ ] Replace `ORDER BY random()` on large tables with a scalable sampling strategy.
- [ ] Add representative performance fixtures and budgets for 25k, 100k and 500k files.

Definition of done: scan throughput and primary web queries stay within documented budgets without unbounded memory growth.

## Phase 7: Error Retention And Observability

Priority: medium.

- [ ] Define retention separately for agent errors, scan history and successful action logs.
- [ ] Add pagination, age/category filters and administrative cleanup.
- [ ] Aggregate repeated errors without losing first/last occurrence and count.
- [ ] Add structured request and correlation IDs across server and companion logs.
- [ ] Publish health and queue diagnostics without exposing secrets or file contents.

Definition of done: diagnostic data remains useful over time while database growth is predictable and controllable.

## Phase 8: Backup And Restore Assurance

Priority: medium, required before declaring production readiness.

- [ ] Provide supported backup scripts for PostgreSQL, thumbnails and deployment configuration.
- [ ] Encrypt backups that contain file paths or private metadata.
- [ ] Document Portainer and plain Docker Compose procedures.
- [ ] Add version compatibility checks and a restore validation command.
- [ ] Produce SBOMs and sign release artifacts and container images in the publishing workflow.
- [ ] Perform and document a clean restore drill before each stable release.

Definition of done: a documented, tested procedure can restore a fresh VideoCAT installation with its database, thumbnails and settings.

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
