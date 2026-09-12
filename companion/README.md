# VideoCAT Companion Binary

This folder is for staging local Windows companion release artifacts before uploading them to GitHub Releases.

Do not commit the `.exe` file to the repository. Upload it as a GitHub Release asset instead, together with the checksum files.

## Build release assets

From Windows PowerShell at the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\package-companion.ps1 -OpenOutput
```

The script stages the current version as:

- `VideoCAT-Companion-X.Y.Z.exe`
- `VideoCAT-Companion-X.Y.Z.exe.sha256`
- `VideoCAT-Companion-X.Y.Z.exe.md5`

## Verify on Windows

PowerShell:

```powershell
Get-FileHash .\VideoCAT-Companion-X.Y.Z.exe -Algorithm SHA256
Get-FileHash .\VideoCAT-Companion-X.Y.Z.exe -Algorithm MD5
```

Prefer SHA-256 for integrity checks. MD5 is included only as a convenience checksum.
