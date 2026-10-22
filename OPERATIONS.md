# VideoCAT Operations Runbook

This runbook covers normal Docker Compose and Portainer deployments. Backups contain private metadata and paths: store them in an encrypted location controlled by the administrator.

## Upgrade

1. Create and verify a backup before changing the stack.
2. Set `VIDEOCAT_VERSION` to a versioned image tag, or use `latest` only when intentionally tracking current releases.
3. In Portainer, pull and redeploy the stack. Prisma migrations run before the API starts.
4. Confirm `GET /api/health` is healthy and open the web application.

The runtime uses non-root application containers. A one-shot `thumbnails-init` service in both Compose files hands an existing `thumbnails_data` volume (created by root-run releases before 0.2.0) to uid 1000 before the API starts, so no manual step is needed. If you run the server without Compose and thumbnail uploads answer `507 Thumbnail storage is not writable`, run once from the stack directory:

```bash
docker run --rm -v "$(docker volume ls -q --filter label=com.docker.compose.project=${COMPOSE_PROJECT_NAME:-videocat} --filter label=com.docker.compose.volume=thumbnails_data | head -n1)":/data alpine:3.21 chown -R 1000:1000 /data
```

The API also logs `THUMBNAILS_DIR ... is not writable` at startup when the volume has the wrong owner.

## Upgrading to 0.2.46

- **Duplicados** says when the drive selection hides groups: with only some drives selected, a group shows only when every copy is on them, so the list could be empty while the *Duplicados probables* card counts every drive. The empty list now reads *No hay duplicados dentro de los discos seleccionados (1 de 22). Hay 562 grupos en todos los discos.* with **Ver todos**.
- No migrations or configuration changes; Companion 0.2.20 and 0.2.21-beta.1 both work with it.

## Windows Companion 0.2.21-beta.1

- **The agent runs as its own executable on Node.js 24.22.1** (`resources/videocat-agent.exe`, Node SEA): scans, the playback tunnel, uploads, deletions, transfers and the local listener no longer run on Electron's Node. Electron (still Node 24.22.0) keeps only the tray and its windows, whose only network calls are pairing and the drive identity check against your own server; updates are downloaded by Velopack.
- Published as a **GitHub prerelease** for testing: installed Companions do not update to it. Install it with its Setup.exe over the current one (settings, pairing and drives are kept); it updates to 0.2.21 when that is published.
- The agent's log starts with `Agente con Node 24.22.1 (videocat-agent.exe)`.

## Upgrading to 0.2.45 (Companion 0.2.21)

- **Renamed folders are not scanned again**: Companion 0.2.21 recognizes a folder renamed or a file moved on the same drive (same size, modification time and extension, and the old path is gone) and moves its catalog entry with `POST /api/agent/scans/:id/relocate`, keeping tags, review, thumbnails and fingerprint. Ambiguous cases (a folder renamed and also copied, two files that fit equally) are scanned as new, as before. Each scan that moves entries leaves a `scan.relocate` action in Auditoría.
- **A copy no longer takes the original's catalog entry**: the server used to guess moves by name, size and time even when the original was still on the drive, so copying a video on the same drive could drop one of the two from the catalog. Companion 0.2.21 decides moves itself (`movesReported`) and the server stops guessing for it; for older Companions the guess skips entries the current scan already saw in place.
- **Drives are pinned by marker, never by letter**: *Añadir unidad… › Convertir…* writes the `.videocat-disk.json`. Routes by letter saved by older Companions show *sigue la letra* and *Fijar identidad…*, which compares a random sample of that catalog (`GET /api/agent/disks/:id/identity-sample`) with the chosen drive before writing the marker with the same id.
- **Names chosen in the web reach the marker**: the heartbeat returns them for the connected drives and the Companion rewrites only `diskName`, atomically.
- No migrations or configuration changes. Server 0.2.45 works with Companion 0.2.20; the new behaviour needs 0.2.21. **Companion 0.2.21 is published once Electron ships the October 2026 Node.js security release** (every Electron release so far embeds Node 24.22.0 and packaging refuses it); until then 0.2.20 keeps working.

## Windows Companion 0.2.20

- Built on Node.js 24.22.1. Companions 0.2.18 (Node 24.21.0) and 0.2.19 (Node 24.22.0) did not carry the security release: the build runner resolved an older Node 24. The release workflow now pins 24.22.1 and fails if the embedded Node differs.
- The server stays on 0.2.44; no migrations or configuration changes.

## Upgrading to 0.2.44 (Companion 0.2.18)

- **Security release**: the server image runs Node.js 24.22.1 and the Companion carries it too ([October 2026 Node.js security releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases): Brotli decoder out-of-bounds write, TLS hostname checks, keep-alive response smuggling). No functional changes.
- No migrations or configuration changes. Companion 0.2.18 updates itself.

## Upgrading to 0.2.43

- **Catálogo**: beside the number of videos, the total size of every match of the current search and filters (not just the page shown), for example *12 videos 340 GB*. It follows each change of search, drive, folder, tag or filter.
- No migrations or configuration changes; the Windows Companion is 0.2.17.

## Windows Companion 0.2.17

- **No more orphan agents**: the agent started by the tray now closes on its own when its tray is gone (closed by force, an installer, a crash), instead of running on and blocking the next update.
- A file found at risk is written to the local scan state at once, so closing the Companion right after never makes the next start read it again.
- If the installer says *Failed to stop application (Access is denied)* and Task Manager shows several *VideoCAT Companion* processes that `taskkill` cannot end, they are stuck in a read on a damaged drive: Windows cannot end a process until that read returns. **Unplug that drive** (they close within seconds) or restart Windows, then run the installer again.
- The server stays on 0.2.42; no migrations or configuration changes.

## Upgrading to 0.2.42 (Companion 0.2.16)

- **Scans no longer stay forever on a file that stops answering** (bad sectors on a connected drive: Windows keeps retrying the read). Every file has a deadline, **Tiempo máximo por archivo** in Companion › Configuración › Avanzado (`COMPANION_FILE_TIMEOUT_SECONDS`, 180 s by default, 30–3600). Past it, the file's FFmpeg/FFprobe processes are stopped and the scan moves on. Each frame extraction also has its own 2-minute limit now.
- The file is catalogued **En riesgo** (badge in the catalog, reason in the detail, category `at_risk_file` in Auditoría) and noted in the Companion's local scan state: later scans skip it without touching it, not even its size, for 30 days, and it still counts as present. After that it is read once more, in case the drive recovered. A file whose basic information (size, date) does not come back within 30 s gets the same treatment. Copy what you can from that drive and check it.
- The agent runs with 16 I/O threads (`UV_THREADPOOL_SIZE`), so one read stuck in the drive never freezes the rest of the Companion.
- **Tray tooltip**: hovering the Companion icon shows what it is doing, the file, how far it got and about how long is left (the same wording as the web's activity panel), for example *VideoCAT · Copiando a la carpeta temporal 63 %*.
- Companion 0.2.16 updates itself. No migrations or configuration changes on the server.

## Upgrading to 0.2.41 (Companion 0.2.15)

- **The tray icon shows when the Companion works**: while it copies, verifies, downloads, scans or deletes, the accent chosen in the web (Tema) travels around the cat's white outline, fading back to white behind it (24 frames, a turn every 1.8 s). Idle, or right after it starts, the icon is white and still as before. The frames are built from the icon itself, at the screen's scale.
- The web sends its accent to the server when it changes and once per visit (`PUT /api/profile/appearance`); the server passes it to the Companion in its heartbeat. Until then the Companion uses Naranja CAT.
- Companion 0.2.15 updates itself. No migrations or configuration changes.

## Upgrading to 0.2.40

- The header's transfers control is now an icon only, the size of the theme button: pause while transfers run, play once stopped, pulsing while the Companion confirms. Its name stays in the tooltip and for screen readers.
- No migrations or configuration changes; the Windows Companion is 0.2.14.

## Upgrading to 0.2.39 (Companion 0.2.14)

- **Detener traslados** in the header, beside the activity indicator (shown while a Companion is connected and there are transfers, or they are stopped). The Companion gets the order with its next heartbeat (about 15 s), finishes the file in progress and starts no other transfer; downloads go on. The button shows *Deteniendo…* until that file is done, then **Reanudar traslados**; Traslados shows a notice with the same button.
- The stop lives only in the running Companion: restarting it goes back to normal transfers, so a forgotten stop never leaves files waiting. Orders given before the Companion started are ignored.
- Needs Companion 0.2.14 (updates itself); an older Companion ignores the order and the button goes back after two minutes. Every stop and resume is recorded in Auditoría (`transfers.stop`, `transfers.resume`).
- No migrations or configuration changes.

## Upgrading to 0.2.38 (Companion 0.2.13)

- **Traslados says when transfers wait for downloads**: while the Companion runs its *A descargar* queue (downloads come first since Companion 0.2.12), Traslados shows *Traslados en espera: el Companion está descargando* with a button to *A descargar*, and the Actividad panel says so too. It disappears as soon as transfers continue.
- Companion 0.2.13 (updates itself) reports that state with its live activity and heartbeat; older servers ignore it.
- No migrations or configuration changes.

## Windows Companion 0.2.12

- **Downloads come before transfers.** When the *A descargar* queue has files for a connected drive, the transfer in progress finishes its current file, then the whole download queue (every connected drive, in one turn) runs before transfers go on. Transfers resume on their own as soon as the queue is empty or paused in the web. Checking an empty queue never interrupts transfers.
- A download requested from the web no longer holds the heartbeat while the queue runs, so the Companion keeps showing as connected during long downloads.
- The server stays on 0.2.37; no migrations or configuration changes.

## Upgrading to 0.2.37 (Companion 0.2.11)

- **Damaged or unfinished videos** (for example an MP4 whose recording or copy stopped before the end: FFmpeg says *moov atom not found* or *Invalid data found when processing input*) are no longer a cryptic metadata error repeated on every scan:
  - Companion 0.2.11 (updates itself) logs *Archivo dañado* with the reason and stores it in the catalog, keeping the tool output as detail;
  - the catalog card shows a **Dañado** badge and the detail shows the reason;
  - Auditoría groups them under the category `damaged_file`;
  - the server no longer offers them for thumbnail repair, so they are only read again when the file changes (a copy that finishes, a repaired file).
- Files already in the catalog with the old error are read once more by the next scan with Companion 0.2.11, get the new message and stop being retried. Nothing is deleted: decide in the catalog what to do with them.
- No migrations or configuration changes.

## Upgrading to 0.2.36 (Companion 0.2.10)

- **Uso por carpeta** shows each selected drive's free space on the map, always in the same color (dashed, not explorable), and the total in the header, so the room left is always in view. It uses the drive's last scan or live report; drives without a measurement are left out. The free blocks hide while searching.
- **Traslados: files leave their drives first.** The server now hands the Companion, in this order: staging copies to clear, files already on their way to staging, files that fit in the staging room left (by the Companion's last report), deliveries, and last the files that did not fit. Companion 0.2.10 (updates itself) stops each file once it is off its drive and delivers in the next round of the same review, so a drive that is both a source and a destination frees room before receiving files. When the staging folder is full, deliveries go first. Companion 0.2.9 keeps working with the new order, delivering each file right after staging it.
- No migrations or configuration changes.

## Upgrading to 0.2.35

- Actividad › Con los discos conectados: each drive is marked with a straight vertical line inset from the corners, instead of a line that curved with the rounded row.
- No migrations or configuration changes; the Windows Companion is 0.2.9.

## Upgrading to 0.2.34

- **New sign-in screen**: a decorative contact sheet of frames beside the form (on a phone, a strip on top), the VideoCAT mark in the chosen accent, ES/EN and theme switches, a show-password button and clear messages for empty fields, a wrong password and too many attempts. It follows light, dark, OLED and the six accents. Nothing from the catalog is shown before signing in: the frames and drives on that screen are illustrations.
- No migrations or configuration changes; the Windows Companion is 0.2.9.

## Upgrading to 0.2.33

- **Actividad › Con los discos conectados**, at the top of the panel: *Faltan x de y por mover* with a progress bar, overall and per connected drive, and a badge per drive: **Puedes desconectarlo** or **Espera** (files still to leave it, files that can arrive now, queued downloads). "y" counts what was done with that drive since it was connected; the connection time is kept in server memory, so after a server restart it starts again at the next heartbeat. Files waiting for room on a drive do not hold it: they stay safe in the staging folder.
- **Palabras clave** of starred folders now match exactly, as whole words of the file name, ignoring case, accents and separators (`GATO`, `.gato.`, `mi_gato_2024` match; `gatos`, `gatito`, `gatoo` do not). The folder name itself keeps the broad search (contained, one letter of difference). Saved keywords keep working; some files that matched before may no longer be offered.
- No migrations or configuration changes; the Windows Companion is 0.2.9.

## Upgrading to 0.2.32

- **Traslados › Para continuar** in two groups, side by side: *Reciben material* (drives that files are copied onto from the staging folder, including *Faltará espacio* and *Libera espacio*) first, and *Copian a la carpeta temporal* (drives whose files still have to leave). Each group shows how many drives and how much data.
- By default the drive that still has to receive the most data comes first; its notices stay together. *Conectados* and *Nombre* are the other orders; the choice is remembered in that browser.
- No migrations or configuration changes; the Windows Companion is 0.2.9.

## Upgrading to 0.2.31

- The drive strip lists the drives connected to the Companion first (each group keeps its alphabetical order) and scrolls back to the start when they are detected, so *Mostrar conectados* never leaves one out of view.
- No migrations or configuration changes; the Windows Companion is 0.2.9.

## Upgrading to 0.2.30

- **Eliminar unidad** in Administración, for drives that no longer exist (shown only while the drive is disconnected; typing ELIMINAR confirms). It removes the drive with its catalog, thumbnails, scans, errors and starred or favorite folders, cancels pending transfers to or from it and closes their jobs. No file on any drive is touched; the deletion history keeps the drive name, and the action is recorded in Auditoría (`disk.remove`). It is refused while the drive is connected (the next scan would add it back) or while files from or to it wait in the Companion staging folder.
- **Uso por carpeta**: instant search on the map (shortcut `/`, Esc clears). Blocks that do not match leave and the rest grow; folders that only lead to a match shrink to it. Case and accents are ignored; at the last level it filters the videos.
- The rename pencil in Administración now sits right after the drive name.
- No migrations or configuration changes; the Windows Companion is 0.2.9.

## Upgrading to 0.2.29 (Companion 0.2.9)

- **Smoother remote playback (4K)**: a playback request used to get 512 KB per round trip, one at a time per Companion, so high-bitrate videos stalled on *cargando* and started slowly. Now each request streams to the end with read-ahead: the server keeps up to 8 chunks in flight with the Companion and holds the amount chosen in **Perfil › Reproducción › Lectura anticipada** (8–128 MB, 32 MB by default) ahead of the browser. nginx no longer buffers `/api/streams/` (no video copies on the web container's disk, and the browser's pace reaches the server).
- Windows Companion 0.2.9 (updates itself) keeps the file open while it plays instead of opening it for every chunk, and lets go of it after 30 s without reads so the drive can be ejected. The server works with Companion 0.2.8 too.
- Opening VideoCAT through a public domain (Cloudflare Tunnel) sends the video out and back through the internet connection, even on the LAN: its upload speed caps playback.
- No migrations or configuration changes.

## Upgrading to 0.2.28

- **Drive names**: Administración lets you rename a drive (pencil next to its name). The chosen name is what everyone sees in VideoCAT and scans keep it; *Usar el nombre detectado* goes back to the Companion's name on the next scan. Useful for drives added by path, which are detected as `H:\`.
- **Favorite folders win**: verified and covered by tests; a favorite is never queued by a tag rule, and marking it afterwards withdraws what had not left its drive.
- **Traslados**: Consolidar, Agrupar and Mover por etiqueta now sit side by side; every transfer is listed in one grid (*Traslados en curso*) with filters by kind. Hovering (or focusing) a card in *Para continuar* shows what is still due on that drive: files to copy onto it in green, files that will leave it in red, with some names.
- Migration `0026_disk_name_locked` runs automatically. No configuration changes; the Windows Companion is 0.2.8.

## Upgrading to 0.2.27

- **Mover por etiqueta** in Traslados: a standing rule "tag → starred folder". Every video with the tag, including the ones tagged later, joins the rule's transfer and moves through the Companion staging folder when its drive is connected. Removing the tag from a video, or removing the rule, withdraws what has not left its drive yet. One folder per tag; "Marcado para borrar" cannot be used. Favorite folders, protected folders, files already in the folder and identical files at the destination are left alone.
- Migration `0025_transfer_tag_rules` runs automatically. No configuration changes; the Windows Companion is 0.2.8.

## Upgrading to 0.2.26

- Transfers no longer wait forever for a file that was moved or deleted by hand: when a scan no longer finds it, its transfers that had not started are cancelled with the reason ("El archivo ya no estaba en su disco en el último escaneo"). Files already in the staging folder are never touched. Existing stuck items are cleared the next time Traslados is opened.
- Checked against production data: transfers do not affect duplicate detection (no duplicate group involved a file in transit, and every finished transfer points to its destination). Duplicates only count files that the last scan of their drive found.
- No migrations or configuration changes; the Windows Companion is 0.2.8.

## Upgrading to 0.2.25

- **Access proxies (Cloudflare Access and similar)**: when the proxy session expired, the installed app opened from its cached shell and every API call failed with "Failed to fetch" (the proxy redirects to its sign-in on another domain, which the CSP blocks). Now:
  - opening or reloading the app asks the network first (the cached shell is only the offline fallback), so the proxy can show its sign-in;
  - if an API call is redirected by a proxy, VideoCAT shows *Tu sesión de acceso expiró* with **Volver a iniciar sesión**, which goes through `/api/session/return` (same-site paths only) and comes back to the same page.
  - Until the new version is installed, press **Ctrl+Shift+R** (Cmd+Shift+R on macOS) on the site to sign in to the proxy again.
- A blocked inline script reported by the browser on a Cloudflare-proxied site comes from scripts Cloudflare injects (for example JavaScript detections); VideoCAT's CSP blocks it on purpose and nothing breaks. It can be turned off in Cloudflare › Security › Bots for that hostname.
- No migrations or configuration changes; the Windows Companion is 0.2.8.

## Upgrading to 0.2.24

- **Uso por carpeta** is now an explorer: a click enters a block and shows that folder's whole distribution (any depth); at the last level the videos themselves appear as blocks sized by file size, with their thumbnail, and a click opens the video. A trail and **Subir** (or Backspace) go back. *Ir al catálogo* moved to the right click menu.
- No migrations or configuration changes; the Windows Companion is 0.2.8.

## Upgrading to 0.2.23

- **Carpetas favoritas** in Uso por carpeta: right click a block (or use the heart in Carpetas repetidas) to mark it as a favorite. Its videos, subfolders included, are never offered to move: they are left out of consolidations, Agrupar archivos and new transfers. Marking a favorite takes its files out of transfers that had not started for them; files already in staging finish their way. A favorite can still receive files if it is also starred.
- Migration `0024_folder_favorites` runs automatically. No configuration changes; the Windows Companion is 0.2.8.

## Upgrading to 0.2.22

- **Palabras clave** for each starred folder (Traslados › Carpetas con estrella): optional extra words that *Agrupar archivos* also looks for, with the same rules as the folder name. The session shows which keyword matched each file.
- Migration `0023_transfer_group_keywords` runs automatically. No configuration changes; the Windows Companion is 0.2.8.

## Upgrading to 0.2.21

- Visual only: Traslados drops the coloured top and left borders that curved with rounded corners; kinds are marked with the house straight vertical line (`vc-accent-bar`). The rule is written in AGENTS.md › UI Conventions.
- No migrations or configuration changes; the Windows Companion is 0.2.8.

## Windows Companion 0.2.8

- **Configuración › Avanzado › Clic en el ícono** (`TRAY_CLICK_ACTION`): a click or double click on the tray icon opens VideoCAT (default), shows the activity window or opens the settings. One action per gesture. Applies as soon as it is saved. The server stays on 0.2.20.

## Upgrading to 0.2.20 (Companion 0.2.7)

- New **activity indicator** in the header, next to the theme button: it shows what the Companion is doing right now (copying to or from the staging folder, verifying, downloading, scanning or deleting) and opens a live panel with progress, speed, ETA, a speed chart, what is waiting and the latest movements.
- Windows Companion 0.2.7 (updates itself) reports that activity about once a second while busy, and the live free space of every connected drive in each heartbeat, so "Faltará espacio" and "Libera espacio" follow what you delete without waiting for a rescan.
- Live activity is kept in server memory only and expires 30 s after a Companion stops reporting. No migrations or configuration changes.

## Upgrading to 0.2.19

- Transfers no longer refuse a destination without room (by its last scan): consolidations and grouped files are created anyway, leave their drives and wait in the Companion staging folder. Traslados shows *Faltará espacio en…* with how much to free; the Companion measures again when the destination is connected and delivers once there is room.
- Release builds compile the web bundle once on the native platform (less memory and time for multi-arch images).
- No migrations or configuration changes; the Windows Companion stays on 0.2.6.

## Upgrading to 0.2.18

- **Traslados** redesigned: summary with the staging folder at the top, a compact "Para continuar" block (drives to connect, space to free, missing staging folder), starred folders as cards with their size, free space and namesakes, and direct **Consolidar** and **Agrupar archivos** buttons. Consolidar and Agrupar now live in two columns with their own colour and their own transfers.
- No migrations or configuration changes; the Windows Companion stays on 0.2.6.

## Upgrading to 0.2.17

- Image hardening after a vulnerability scan of 0.2.16 (Docker Scout / Trivy):
  - Server image moves from Debian 12 (bookworm) to **Debian 13 (trixie)** and installs the latest security updates on every build. Critical findings go from 4 to 0; the remaining ones are Debian advisories without a published fix, in system tools the server does not use.
  - The server image no longer ships `npm`, `npx`, `corepack` or `yarn` (the Node base image bundles them with their own vulnerable dependencies). Migrations run with the Prisma CLI directly. If you ran `npx` inside the container by hand, use `./node_modules/.bin/prisma` instead.
  - Web image applies Alpine security updates on every build.
  - CI scans both images with Trivy and fails on critical or high findings that already have a fix.
- No configuration changes; the Windows Companion stays on 0.2.6.

## Upgrading to 0.2.16

- Transfers: every state change reported by a Companion is now applied atomically against the state and holder it was based on, so a cancel from the web or two Companions at the same moment can never overwrite each other.
- The catalog folder tree has an **Agrupar archivos** shortcut on every folder.
- No migrations or configuration changes; the Windows Companion stays on 0.2.6.

## Upgrading to 0.2.15

- **Agrupar archivos** in Traslados: pick a folder (it gets a star) and decide, file by file like in Review, which files with a similar name on any drive move into it (`F` group, `J` ignore, `Z` undo). Files travel through the Companion staging folder exactly like a consolidation.
- Migration `0022_transfer_group_ignores` runs automatically. No configuration changes; the Windows Companion stays on 0.2.6.

## Upgrading to 0.2.14 (Companion 0.2.6)

- New section **Traslados** (`/traslados`) and **Consolidar** in Uso por carpeta: star the folder that should receive the contents of its namesakes; files move through a local staging folder of the Companion and are only removed from a place after their copy in the next one is verified with SHA-256.
- Migration `0021_transfers` runs automatically when the server starts.
- Windows Companion 0.2.6 (updates itself): set **Configuración › Archivos › Carpeta temporal de traslados** (`COMPANION_STAGING_DIR`). Without it transfers wait; the Companion always leaves 5 % of that drive free. `COMPANION_TRANSFER_POLL_MS` (default 60000) sets how often it checks for transfer work.

## Upgrading to 0.2.13

- New section **Uso por carpeta** (`/uso-por-carpeta`): folders with the same name are merged across drives and levels; exclusions are stored on the server. No configuration changes; the Windows Companion stays on 0.2.5.

## Upgrading to 0.2.12 (Companion 0.2.5)

- Dependency maintenance: nginx 1.31.6, @fastify/multipart, cookie and cors, ws and Vite updates. Prisma stays on 6.12 because 6.13 through 7.x pull a vulnerable deepmerge-ts into the migration CLI.
- Windows Companion 0.2.5 moves to Electron 42.11.12 (Chromium security fixes); installed Companions update themselves.
- No configuration changes.

## Upgrading to 0.2.11 (Companion 0.2.4)

- Fixes Companion heartbeats failing with `400 Invalid uuid` on `mountedDiskIds`. Folders added by hand in the tray had non-UUID ids; the server now accepts them, so those Companions show as online again and their delete and download queues are processed. Deploy the server first: it fixes existing installations without touching the Companion.
- Windows Companion 0.2.4 gives newly added folders real UUIDs. Installed Companions update themselves; existing folders keep their ids and catalog.

## Upgrading to 0.2.10

- Review shows vertical videos whole: a vertical canvas on phones, a blurred fill instead of black bars, and 9:16 gallery tiles. No configuration changes.

## Upgrading to 0.2.9

- The "new version" prompt of the installed app always reloads into the new version. If an older prompt does nothing, close every VideoCAT window and tab and open it again. No configuration changes.

## Upgrading to 0.2.8

- Review shortcuts changed: `Space` now toggles a privacy mode (black screen, decisions disabled) and `Enter` plays the frames. Decisions show a short confirmation at every screen size. No configuration changes; the Windows Companion stays on 0.2.3.

## Upgrading to 0.2.7

- VideoCAT is now an installable web app (PWA). Browsers only offer installation over HTTPS (or `localhost`); keep the reverse proxy forwarding every path to the `web` container so `/sw.js` and `/manifest.webmanifest` are served with their own cache headers.
- Security fix in the `web` image: the HTML and static files were served without CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` and HSTS because nginx drops server-level headers in locations that set their own. Every route now sends them. If your reverse proxy adds its own CSP, make sure it allows `worker-src 'self'` and `manifest-src 'self'`.
- No configuration changes; the Windows Companion stays on 0.2.3.

## Upgrading to 0.2.6

- Security update: `@fastify/busboy` 3.2.2 fixes a high-severity denial of service through malformed multipart uploads (GHSA-xjh9-v7x6-24jw, GHSA-x8mw-p69m-v3mx), and `fastify` 5.12.5 / `fast-uri` fix two moderate advisories. Upgrade from 0.2.5 or earlier; no configuration changes.

## Upgrading to 0.2.5

- On phones and tablets, the fullscreen frame gallery (Review and file detail) moves between frames with horizontal swipes. No configuration changes; the Windows Companion stays on 0.2.3.

## Upgrading to 0.2.4

- The Duplicates badge in the menu now counts only groups that still need a decision (two or more copies not marked for deletion), using the same detection as the Duplicates view. No configuration changes; the Windows Companion stays on 0.2.3.

## Upgrading to 0.2.3

- Docker stack: the mobile Review confirms each decision with a short animation, keeps the file name pinned at the top and returns to the top after every decision. No configuration changes.
- The Windows Companion now ships as `VideoCAT-Companion-win-Setup.exe` and updates itself from GitHub Releases. On each PC, close the portable `.exe` (0.2.2 or earlier), run Setup.exe once and delete the portable file; settings and pairing in `%APPDATA%\VideoCAT Companion` are kept.

## Upgrading to 0.2.2

- Review shortcuts changed: `F` keeps, `J` marks for deletion and `P` toggles full screen.
- Install Windows Companion 0.2.2 for the paged settings window.

## Upgrading to 0.2.1

- Update the stack's Compose file from `docker-compose.hub.yml`: it adds the one-shot `thumbnails-init` service that repairs thumbnail uploads failing after 0.2.0 on existing volumes.
- Install Windows Companion 0.2.1 for the redesigned settings window and clearer upload error logs.

## Upgrading to 0.2.0

- Install Windows Companion 0.2.0 on every PC. On first start it generates `COMPANION_TOKEN` if none exists.
- Open the Companion settings, use **Copiar token** and paste it in VideoCAT › Profile › Local Companion in each browser that opens, copies or deletes files on that PC. Until then, those local actions answer "token missing or invalid"; remote playback, scans and queues through the server keep working.
- Theme, density and language preferences are stored per browser; earlier light/dark choices are kept.

## Backup

```bash
./scripts/backup.sh
./scripts/verify-backup.sh ./backups/videocat-YYYYMMDDTHHMMSSZ
```

PowerShell:

```powershell
.\scripts\backup.ps1
```

The backup includes a PostgreSQL dump, `thumbnails_data`, checksums and `.env` when it exists. Protect the generated directory with filesystem permissions and encryption. Do not commit it.

## Restore Drill

Restoration replaces database contents and thumbnail files. Test it first in a separate Compose project:

```bash
./scripts/restore.sh ./backups/videocat-YYYYMMDDTHHMMSSZ --confirm
```

Restart the server and web services after a successful restore.

## Proxy And Retention

- Set `TRUST_PROXY_CIDRS` to the reverse proxy IP or CIDR whenever possible, for example `172.16.0.0/12,192.168.1.30`.
- Keep `COOKIE_SECURE=true` for HTTPS deployments.
- Retention is configured by `AGENT_ERROR_RETENTION_DAYS`, `ACTION_AUDIT_RETENTION_DAYS` and `SCAN_RETENTION_DAYS`.
- Invoke `POST /api/admin/maintenance/prune` as an authenticated administrator to remove eligible historical records. It never deletes catalogued videos or thumbnails.

## Release Evidence

Tags run the SBOM workflow and attach a GitHub artifact attestation. Docker image signing requires a configured publishing workflow and registry credentials; until then, use immutable version tags and verify the Companion SHA-256 release asset.
