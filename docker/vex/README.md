# VEX documents

[OpenVEX](https://openvex.dev) statements for vulnerabilities that scanners report in the VideoCAT images but that do not affect them. Each file says why, and covers only the exact package version it was checked against: a newer package that is affected is reported again.

| File | Images | Why it does not apply |
| --- | --- | --- |
| `CVE-2026-85091.vex.json` | `videocat-server`, `videocat-scanner` | The overflow is in zlib's non-blocking `gzwrite()` support, added in 1.3.1.2; Debian trixie ships zlib 1.3.1. Nothing in the images uses `gzwrite()`/`gzprintf()`, and Node.js carries its own zlib. The web image (Alpine) already has the fixed `zlib 1.3.2-r1`. |

They are attached to each published image as attestations (see "Publishing releases" in the README). To check one locally against a published image:

```bash
docker scout cves registry://reiterstahl/videocat-server:0.2.50 --vex-location docker/vex --vex-author '.*' --only-vex-affected
```

Remove a document once the base image ships a package version outside the affected range.
