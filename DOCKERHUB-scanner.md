# VideoCAT Scanner

Optional S3 scanner for **VideoCAT**, a private, self-hosted catalog for videos spread across external drives and, with this image, S3-compatible buckets (MinIO, Garage, RustFS, AWS S3, Cloudflare R2, Backblaze B2…).

- Website: https://videocat.centeran.com
- Source code and docs: https://github.com/reiterstahl/videocat

## What this image runs

`reiterstahl/videocat-scanner` is the VideoCAT server's code plus FFmpeg, started as a background worker:

- Scans the buckets added in **Administration › S3 storage**: lists each bucket under its prefix, reads new or changed videos by ranges through short-lived signed URLs (never downloading them whole), and writes metadata, 15 thumbnails and a perceptual fingerprint to the catalog. An object copied to another key keeps its catalog entry.
- Rescans every `S3_SCAN_INTERVAL_HOURS` (24) and when **Scan now** is pressed.
- Deletes the bucket videos marked in Review when *Procesar pendientes* asks for it, after checking each object's size and ETag.
- Serves nothing over HTTP and needs no session, Companion or admin secrets.

It is only needed for S3 buckets. The server image stays without FFmpeg.

## Use it with Compose

The official `docker-compose.hub.yml` includes it under the `s3` profile:

```bash
docker compose -f docker-compose.hub.yml --profile s3 up -d
```

In Portainer, add the variable `COMPOSE_PROFILES=s3` to the stack and redeploy it.

It needs the same `DATABASE_URL` as the server, `STORAGE_SECRET_KEY` (64 hexadecimal characters, the key that encrypts the buckets' secret keys) and the `thumbnails_data` volume at `/data/video-catalog/thumbnails`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | The VideoCAT PostgreSQL database. |
| `STORAGE_SECRET_KEY` | Same value as the server's. |
| `THUMBNAILS_DIR` | `/data/video-catalog/thumbnails` (shared with the server). |
| `S3_SCAN_INTERVAL_HOURS`, `S3_SCAN_CONCURRENCY` | How often each bucket is rescanned (24) and how many videos are read at a time (2). |

## Tags and platforms

- `0.2.50`, `0.2.49`, … — versioned, stable tags, always the same version as `videocat-server`.
- `latest` — the newest published release.

Images are built for `linux/amd64` and `linux/arm64`. Like the server, the container runs as the non-root user `node` (uid 1000); the official Compose file makes its root file system read-only and drops all capabilities.

## Privacy

For buckets, VideoCAT holds an encrypted key to the bucket and reads its videos (temporary frames are deleted right away; besides thumbnails, nothing of the videos stays on the server). Give it a key limited to that bucket or prefix, with delete permission only if you delete from Review.

License: AGPL-3.0-or-later.
