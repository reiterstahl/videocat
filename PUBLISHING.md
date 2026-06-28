# Publishing Checklist

Use this checklist before making VideoCAT public or publishing official release artifacts.

This workflow is designed to keep a personal/local VideoCAT instance usable while preparing a clean public release. Do not rewrite history from the working copy that runs your local instance.

## 1. Back up private history

Create a local bundle before rewriting or replacing public history:

```bash
mkdir -p ../_backups/videocat
bundle="../_backups/videocat/videocat-history-$(date +%Y%m%d-%H%M%S).bundle"
git bundle create "$bundle" --all
git bundle verify "$bundle"
```

Keep this bundle outside the public repository.

## 2. Check the public snapshot

Before publishing, verify that only safe files are tracked:

```bash
git status --short
git ls-files
rg -n -i "(password|secret|token|api[_-]?key|private[_-]?key|client[_-]?secret|database_url)" \
  --glob '!package-lock.json' \
  --glob '!node_modules/**' \
  --glob '!dist/**' \
  --glob '!release/**'
```

Expected findings should be placeholders, environment variable names, or security-related code.

## 3. Build locally

```bash
npm run build
```

For the Windows tray companion:

```powershell
npm run package:tray -w @videocat/agent-windows
```

Do not commit generated `dist`, `release`, `.env`, database, thumbnail, or log files.

## 4. Prepare clean history in a separate worktree

Only do this after verifying the backup and reviewing the final diff.

Create a separate worktree for the public release:

```bash
git worktree add ../videocat-public-prep HEAD
cd ../videocat-public-prep
```

Then create the clean public branch inside that worktree:

```bash
git switch --orphan public-main
git add -A
git commit -m "Initial public release"
```

At this point, inspect the result before touching GitHub:

```bash
git status
git log --oneline --decorate -n 5
```

When the clean public branch is approved, push it deliberately:

```bash
git push origin public-main:main --force-with-lease
```

This replaces the public branch history with a single clean snapshot, without rewriting the history in the local working copy used by your personal instance. Existing private history remains recoverable from the bundle created in step 1.

After publishing, the local instance can keep using its existing working copy, `.env`, Docker volumes, database, and companion configuration.

## 5. Required release notes

Official VideoCAT distributions should include:

- `LICENSE`
- `NOTICE`
- `README.md`
- `README.en.md`
- `.env.example`

Forks and modified versions may remove or replace optional donation links, provided they comply with the project license and preserve required copyright and attribution notices.

## 6. Windows companion release asset

Do not commit Windows companion binaries to Git. Upload them as GitHub Release assets instead.

Recommended assets for each release:

- `VideoCAT-Companion-<version>.exe`
- `VideoCAT-Companion-<version>.exe.sha256`
- `VideoCAT-Companion-<version>.exe.md5`

Generate checksums from the artifact folder:

```bash
cd companion
sha256sum VideoCAT-Companion-0.1.0.exe > VideoCAT-Companion-0.1.0.exe.sha256
md5sum VideoCAT-Companion-0.1.0.exe > VideoCAT-Companion-0.1.0.exe.md5
```

Prefer SHA-256 for user-facing verification. MD5 may be published as a convenience checksum, but it should not be described as a security guarantee.
