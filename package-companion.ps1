#requires -Version 5.1

[CmdletBinding()]
param(
  [switch]$SkipInstall,
  [switch]$SkipChecks,
  [ValidateSet("none", "patch", "minor", "major")]
  [string]$Bump = "none",
  [bool]$Stage = $true,
  [switch]$PublishRelease,
  [switch]$OpenOutput
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-NativeStep {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  Write-Host "`n==> $Label" -ForegroundColor Cyan
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE."
  }
}

if ($env:OS -ne "Windows_NT") {
  throw "This script must run in Windows PowerShell or PowerShell 7 on Windows."
}

$repoRoot = $PSScriptRoot
$agentDirectory = Join-Path $repoRoot "apps\agent-windows"
$agentPackagePath = Join-Path $agentDirectory "package.json"
$releaseDirectory = Join-Path $agentDirectory "release"
$stagingDirectory = Join-Path $repoRoot "companion"

if (-not (Test-Path -LiteralPath $agentPackagePath -PathType Leaf)) {
  throw "Run this script from a complete VideoCAT repository checkout."
}

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
  $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
}
if (-not $npmCommand) {
  throw "npm was not found. Install Node.js 22 or newer and open a new PowerShell window."
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
}
if (-not $nodeCommand) {
  throw "Node.js was not found. Install Node.js 22 or newer and open a new PowerShell window."
}

Push-Location $repoRoot
try {
  $nodeVersionText = (& $nodeCommand.Source --version).TrimStart("v")
  $nodeMajor = [int]($nodeVersionText.Split(".")[0])
  if ($nodeMajor -lt 22) {
    throw "Node.js 22 or newer is required. Found v$nodeVersionText."
  }

  Write-Host "VideoCAT Companion release builder" -ForegroundColor White
  Write-Host "Repository: $repoRoot"
  Write-Host "Node.js: v$nodeVersionText"

  if ($PublishRelease -and $Bump -ne "none") {
    throw "Commit and push the version bump first, then run -PublishRelease without -Bump."
  }

  if ($Bump -ne "none") {
    Invoke-NativeStep -Label "Bump Companion $Bump version" -Command $npmCommand.Source -Arguments @(
      "version", $Bump, "-w", "@videocat/agent-windows", "--no-git-tag-version"
    )
  }

  $agentPackage = Get-Content -LiteralPath $agentPackagePath -Raw | ConvertFrom-Json
  $version = [string]$agentPackage.version
  if (-not $version) {
    throw "The Companion version is missing from apps\agent-windows\package.json."
  }

  $packId = "VideoCAT-Companion"
  $velopackDirectory = Join-Path $releaseDirectory "velopack"
  $unpackedDirectory = Join-Path $releaseDirectory "win-unpacked"
  $setupPath = Join-Path $velopackDirectory "$packId-win-Setup.exe"

  Write-Host "Companion version: $version" -ForegroundColor Green

  if ($PublishRelease) {
    # Pushing a new version to main already publishes it (release-companion.yml); this only
    # starts that workflow by hand, for example after a failed run.
    $gitCommand = Get-Command git -ErrorAction SilentlyContinue
    $ghCommand = Get-Command gh.exe -ErrorAction SilentlyContinue
    if (-not $ghCommand) {
      $ghCommand = Get-Command gh -ErrorAction SilentlyContinue
    }
    if (-not $gitCommand -or -not $ghCommand) {
      throw "git and the GitHub CLI (gh) are required for -PublishRelease."
    }
    $dirty = & $gitCommand.Source status --porcelain
    if ($dirty) {
      throw "The working tree has uncommitted changes. Commit and push them before publishing."
    }
    Invoke-NativeStep -Label "Fetch origin" -Command $gitCommand.Source -Arguments @("fetch", "origin", "--tags")
    $head = (& $gitCommand.Source rev-parse HEAD).Trim()
    $remoteMain = (& $gitCommand.Source rev-parse origin/main).Trim()
    if ($head -ne $remoteMain) {
      throw "HEAD is not origin/main. Push main first: the push itself publishes v$version."
    }
    Invoke-NativeStep -Label "Start the release workflow for v$version" -Command $ghCommand.Source -Arguments @(
      "workflow", "run", "release-companion.yml", "--ref", "main", "-f", "publish=true"
    )
    Write-Host "`nGitHub Actions builds Setup.exe and publishes v$version unless that tag already exists:" -ForegroundColor Green
    Write-Host "https://github.com/reiterstahl/videocat/actions/workflows/release-companion.yml"
    return
  }

  if (-not $SkipInstall) {
    Invoke-NativeStep -Label "Install locked dependencies" -Command $npmCommand.Source -Arguments @("ci")
  }

  if (-not $SkipChecks) {
    Invoke-NativeStep -Label "Build shared package" -Command $npmCommand.Source -Arguments @(
      "run", "build", "-w", "@videocat/shared"
    )
    Invoke-NativeStep -Label "Type-check Companion runtime" -Command $npmCommand.Source -Arguments @(
      "run", "typecheck", "-w", "@videocat/agent-windows"
    )
    Invoke-NativeStep -Label "Type-check Electron tray" -Command $npmCommand.Source -Arguments @(
      "run", "typecheck:tray", "-w", "@videocat/agent-windows"
    )
  }

  Invoke-NativeStep -Label "Build Windows application" -Command $npmCommand.Source -Arguments @(
    "run", "package:tray", "-w", "@videocat/agent-windows"
  )

  $vpkCommand = Get-Command vpk -ErrorAction SilentlyContinue
  if (-not $vpkCommand) {
    Write-Host "`nVelopack CLI not found: skipping Setup.exe. Install it with: dotnet tool install -g vpk --version 1.2.161" -ForegroundColor Yellow
    Write-Host "Application folder: $unpackedDirectory"
    return
  }

  if (Test-Path -LiteralPath $velopackDirectory) {
    Remove-Item -LiteralPath $velopackDirectory -Recurse -Force
  }
  Invoke-NativeStep -Label "Pack installer with Velopack" -Command $vpkCommand.Source -Arguments @(
    "pack",
    "--packId", $packId,
    "--packVersion", $version,
    "--packDir", $unpackedDirectory,
    "--mainExe", "VideoCAT Companion.exe",
    "--packTitle", "VideoCAT Companion",
    "--packAuthors", "VideoCAT",
    "--icon", (Join-Path $agentDirectory "build\icon.ico"),
    "--outputDir", $velopackDirectory
  )
  if (-not (Test-Path -LiteralPath $setupPath -PathType Leaf)) {
    throw "vpk finished but $setupPath was not created."
  }

  $sha256 = (Get-FileHash -LiteralPath $setupPath -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText("$setupPath.sha256", "$sha256  $packId-win-Setup.exe`r`n", [Text.Encoding]::ASCII)

  if ($Stage) {
    New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null
    Copy-Item -LiteralPath $setupPath, "$setupPath.sha256" -Destination $stagingDirectory -Force
  }

  $sizeMb = [Math]::Round((Get-Item -LiteralPath $setupPath).Length / 1MB, 1)
  Write-Host "`nCompanion package completed." -ForegroundColor Green
  Write-Host "Installer: $setupPath"
  Write-Host "Size: $sizeMb MB"
  Write-Host "SHA-256: $sha256"
  Write-Host "Velopack packages: $velopackDirectory"

  if ($OpenOutput) {
    $outputDirectory = if ($Stage) { $stagingDirectory } else { $velopackDirectory }
    Invoke-Item -LiteralPath $outputDirectory
  }
}
finally {
  Pop-Location
}
