$ErrorActionPreference = "Stop"

$RepoRawBase = if ($env:VIDEOCAT_REPO_RAW_BASE) { $env:VIDEOCAT_REPO_RAW_BASE } else { "https://raw.githubusercontent.com/reiterstahl/videocat/main" }
$InstallDir = if ($env:VIDEOCAT_INSTALL_DIR) { $env:VIDEOCAT_INSTALL_DIR } else { "videocat" }
$ComposeFile = "docker-compose.hub.yml"

function New-RandomHex {
  param([int] $Bytes = 32)
  $buffer = New-Object byte[] $Bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($buffer)
  } finally {
    $rng.Dispose()
  }
  return -join ($buffer | ForEach-Object { $_.ToString("x2") })
}

function New-RandomPin {
  $buffer = New-Object byte[] 4
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($buffer)
  } finally {
    $rng.Dispose()
  }
  $value = [BitConverter]::ToUInt32($buffer, 0)
  return (1000 + ($value % 9000)).ToString()
}

function Test-Command {
  param([string] $Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

if (-not (Test-Command "docker")) {
  Write-Error "Docker is required. Install Docker Desktop first, then run this script again."
  exit 1
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Set-Location $InstallDir

$composeUrl = "$RepoRawBase/$ComposeFile"
Invoke-WebRequest -Uri $composeUrl -OutFile $ComposeFile -UseBasicParsing

if (-not (Test-Path ".env")) {
  $jwtSecret = New-RandomHex
  $agentToken = New-RandomHex
  $postgresPassword = New-RandomHex
  $adminPassword = New-RandomHex
  $protectedPin = New-RandomPin

  $envContent = @"
POSTGRES_DB=videocat
POSTGRES_USER=videocat
POSTGRES_PASSWORD=$postgresPassword
WEB_ORIGIN=http://localhost:8081
TRUST_PROXY=true
COOKIE_SECURE=false
WEB_BIND_ADDR=0.0.0.0
WEB_PUBLISHED_PORT=8081
SERVER_BIND_ADDR=127.0.0.1
SERVER_PUBLISHED_PORT=4001
JWT_SECRET=$jwtSecret
AGENT_TOKEN=$agentToken
PROTECTED_FOLDER_PIN=$protectedPin
PROTECTED_FOLDER_PATTERNS=Private,Protected
ADMIN_USER=admin
ADMIN_PASSWORD=$adminPassword
VIDEOCAT_VERSION=0.1.0
"@

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Join-Path (Get-Location) ".env"), $envContent, $utf8NoBom)

  Write-Host "Created .env with generated secrets."
  Write-Host "Admin user: admin"
  Write-Host "Admin password: $adminPassword"
  Write-Host "Protected folder PIN: $protectedPin"
  Write-Host "Agent token: $agentToken"
  Write-Host ""
  Write-Host "Save these values now. They are also stored in $((Get-Location).Path)\.env."
} else {
  Write-Host ".env already exists; keeping existing configuration."
}

docker compose -f $ComposeFile pull
docker compose -f $ComposeFile up -d

Write-Host ""
Write-Host "VideoCAT is starting."
Write-Host "Open: http://localhost:8081"
