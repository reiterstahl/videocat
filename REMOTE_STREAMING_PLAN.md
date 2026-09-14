# Secure Remote Streaming Plan

[Versión en español](REMOTE_STREAMING_PLAN.es.md)

## Goal

Allow an authenticated browser to play a video stored on a PC running VideoCAT Companion, including from another device, without exposing Companion ports to the LAN or Internet and without permanently copying the file to the server.

The first release should stream the original file. Transcoding belongs in a later phase because it adds CPU load, codec compatibility concerns and FFmpeg process control.

## Principles

- Companion always initiates the outbound `wss://` connection.
- The server never accepts an arbitrary path supplied by the browser.
- Every playback uses a short-lived, revocable session tied to the correct user, file and Companion.
- Companion validates the disk, marker and canonical path containment again before reading.
- Streaming is a read-only capability separate from open, copy and delete permissions.
- Original files are never stored permanently on the server.
- Backpressure, memory limits and cancellation are mandatory to prevent OOM conditions.

## Proposed Architecture

1. Companion pairs with the server and stores an individual credential protected with DPAPI.
2. Companion maintains an authenticated outbound WebSocket to the server.
3. The browser requests a session for a `videoFileId` through the authenticated web API.
4. The server checks permissions, protected-folder PIN state, file presence, mounted disk and the Companion's `stream:read` capability.
5. The server creates a short-lived opaque session and sends a signed command containing identifiers, never a browser-selected path.
6. The `<video>` element requests same-origin content from VideoCAT using HTTP Range.
7. The server translates each validated range into binary WebSocket messages. Companion reads only that range and returns it with backpressure.
8. Closing, expiry or connection loss cancels handles, buffers and pending requests at both ends.

## Proposed API And Messages

Web API:

- `POST /api/stream-sessions`: create a temporary session for a file.
- `GET /api/stream-sessions/:id`: return status and capabilities.
- `DELETE /api/stream-sessions/:id`: cancel the session.
- `GET|HEAD /api/streams/:id/content`: return validated `Accept-Ranges`, `Content-Range`, `Content-Length` and MIME headers.

Tunnel messages:

- `stream.open`: prepare and validate a file.
- `stream.ready`: report size, MIME and availability.
- `stream.range`: request a bounded offset and length.
- `stream.chunk`: return sequenced binary data.
- `stream.cancel`: release a request or session.
- `stream.error`: return a sanitized code without leaking local paths.

Every message carries a `requestId`, `sessionId`, sequence number and explicit size limit. Commands must be idempotent and rejected after expiry.

## Security Controls

- Complete per-agent credentials and revocation from Security Roadmap Phase 2 first.
- Store only session-token hashes; use at least 128 random bits and short expiry times.
- Use `HttpOnly`, `Secure` and `SameSite` web cookies; never put persistent secrets in URLs.
- Bind each session to the authenticated user and selected Companion.
- Reapply protected-folder authorization when creating and consuming a session.
- Resolve paths from catalog data and require canonical containment inside a monitored root.
- Reject symlinks, devices, pipes, unmonitored UNC paths and files that change during a session.
- Allow only configured video extensions/MIME types and send `X-Content-Type-Options: nosniff`.
- Limit concurrent sessions, range sizes, bandwidth and idle time per user and Companion.
- Audit creation, start, completion, cancellation and errors without storing tokens or unnecessary absolute paths.
- Keep `stream:read` separate from `file:delete`, `file:copy` and administrative capabilities.

## Delivery Phases

Current status: Companion pairing, encrypted individual credentials, per-Companion revocation, the outbound tunnel, HTTP Range reads, and the initial web playback experience are implemented in `v0.1.16`. The next increment is codec compatibility.

### Phase 0: Protocol And Threat Model — Complete In v0.1.14

- Document assets, attackers, trust boundaries and disconnect behavior.
- Define states, maximum sizes, errors and negotiated protocol version.
- Add tests for tokens, authorization, HTTP Range and path containment.

### Phase 1: Identity And Control Tunnel — Complete In v0.1.14

- Companion pairing, encrypted individual credentials, and revocation are complete.
- Outbound WebSocket uses an authenticated initial message, a 16 KB limit, handshake timeout, ping/pong, and reconnect backoff.
- Administration shows the secure tunnel state for each Companion.
- Existing heartbeats and commands remain compatible; the tunnel does not yet accept file reads or write actions.

### Phase 2: Direct HTTP Range Streaming — Complete In v0.1.15

- Temporary sessions are tied to the file, Companion and authenticated web session.
- The Range/WebSocket bridge is limited to 512 KiB per request, with timeouts and immediate cancellation.
- `GET` and `HEAD` return valid HTTP Range headers; seeking never buffers an entire video in memory.
- One active playback per Companion, with Windows revalidating the drive, canonical path, extension and size.

### Phase 3: Web Experience — Complete In v0.1.16

- The detail modal enables remote Play only while the Companion and disk report availability.
- Local opening retains visual priority and remains available from the PC running the Companion.
- The player shows connection, buffering, playback, stop and disconnect states without exposing local paths.
- Local-only actions remain separate and are not enabled from mobile when the local listener is absent.

### Phase 4: Codec Compatibility

- Detect whether the browser can play the original codec before starting.
- Optionally add temporary HLS/fMP4 remuxing or transcoding through FFmpeg.
- Bound CPU, process count, resolution and duration; cancel FFmpeg when the session closes.
- Do not enable automatic transcoding on small installations without consent.

### Phase 5: Hardening And Release

- Test replay, traversal, cross-user sessions, revoked Companions and slow connections.
- Measure memory with large files, repeated seeking and clients that stop reading.
- Add configurable limits, metrics and correlated audit records.
- Release the feature as opt-in first and document how to disable it.

## Definition Of Done

- Companion requires no inbound port.
- The browser never sends or receives an absolute Windows path.
- A captured token cannot be replayed or used for another file.
- Playback supports HTTP Range seeking without buffering the entire file in memory.
- Browser, disk or Companion disconnects release resources within a bounded time.
- Protected folders retain the same PIN policy.
- Remote reads are audited and revocable per Companion.
- Automated tests cover authorization, paths, ranges, reconnects and memory bounds.

## Recommended Decision

Do not bind the current local listener to `0.0.0.0`. It exposes sensitive operations, and an HTTPS page cannot safely depend on local HTTP without mixed-content issues. The authenticated outbound tunnel preserves a single access boundary at the VideoCAT server.
