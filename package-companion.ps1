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

  $artifactName = "VideoCAT-Companion-$version.exe"
  $artifactPath = Join-Path $releaseDirectory $artifactName
  $sha256Path = "$artifactPath.sha256"
  $md5Path = "$artifactPath.md5"

  Write-Host "Companion version: $version" -ForegroundColor Green

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

  if (Test-Path -LiteralPath $artifactPath) {
    Remove-Item -LiteralPath $artifactPath -Force
  }

  Invoke-NativeStep -Label "Build portable Windows executable" -Command $npmCommand.Source -Arguments @(
    "run", "package:tray", "-w", "@videocat/agent-windows"
  )

  if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
    throw "electron-builder finished but $artifactName was not created."
  }

  $sha256 = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $md5 = (Get-FileHash -LiteralPath $artifactPath -Algorithm MD5).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText($sha256Path, "$sha256  $artifactName`r`n", [Text.Encoding]::ASCII)
  [IO.File]::WriteAllText($md5Path, "$md5  $artifactName`r`n", [Text.Encoding]::ASCII)

  $publishFiles = @($artifactPath, $sha256Path, $md5Path)
  if ($Stage) {
    New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null
    foreach ($file in $publishFiles) {
      Copy-Item -LiteralPath $file -Destination $stagingDirectory -Force
    }
    $publishFiles = $publishFiles | ForEach-Object {
      Join-Path $stagingDirectory (Split-Path $_ -Leaf)
    }
  }

  if ($PublishRelease) {
    $ghCommand = Get-Command gh.exe -ErrorAction SilentlyContinue
    if (-not $ghCommand) {
      $ghCommand = Get-Command gh -ErrorAction SilentlyContinue
    }
    if (-not $ghCommand) {
      throw "GitHub CLI was not found. Install gh and authenticate before using -PublishRelease."
    }

    Invoke-NativeStep -Label "Verify GitHub release v$version" -Command $ghCommand.Source -Arguments @(
      "release", "view", "v$version"
    )
    $uploadArguments = @("release", "upload", "v$version") + $publishFiles + @("--clobber")
    Invoke-NativeStep -Label "Upload release assets" -Command $ghCommand.Source -Arguments $uploadArguments
  }

  $sizeMb = [Math]::Round((Get-Item -LiteralPath $artifactPath).Length / 1MB, 1)
  Write-Host "`nCompanion package completed." -ForegroundColor Green
  Write-Host "Executable: $artifactPath"
  Write-Host "Size: $sizeMb MB"
  Write-Host "SHA-256: $sha256"
  Write-Host "MD5: $md5"
  if ($Stage) {
    Write-Host "Release assets: $stagingDirectory"
  }

  if ($OpenOutput) {
    $outputDirectory = if ($Stage) { $stagingDirectory } else { $releaseDirectory }
    Invoke-Item -LiteralPath $outputDirectory
  }
}
finally {
  Pop-Location
}
