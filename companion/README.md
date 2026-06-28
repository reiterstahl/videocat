# VideoCAT Companion Binary

This folder is for staging local Windows companion release artifacts before uploading them to GitHub Releases.

Do not commit the `.exe` file to the repository. Upload it as a GitHub Release asset instead, together with the checksum files.

## Current artifact

- `VideoCAT-Companion-0.1.0.exe`
- `VideoCAT-Companion-0.1.0.exe.sha256`
- `VideoCAT-Companion-0.1.0.exe.md5`

## Verify on Windows

PowerShell:

```powershell
Get-FileHash .\VideoCAT-Companion-0.1.0.exe -Algorithm SHA256
Get-FileHash .\VideoCAT-Companion-0.1.0.exe -Algorithm MD5
```

Prefer SHA-256 for integrity checks. MD5 is included only as a convenience checksum.
