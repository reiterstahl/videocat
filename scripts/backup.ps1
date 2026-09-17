param(
  [string]$Destination = ".\backups"
)

$ErrorActionPreference = "Stop"
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$folder = Join-Path $Destination "videocat-$stamp"
New-Item -ItemType Directory -Force -Path $folder | Out-Null

$project = if ($env:COMPOSE_PROJECT_NAME) { $env:COMPOSE_PROJECT_NAME } else { Split-Path (Get-Location) -Leaf }
$postgres = docker compose ps -q postgres
if (-not $postgres) { throw "PostgreSQL is not running for this Compose project." }
$volume = docker volume ls -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.volume=thumbnails_data" | Select-Object -First 1
if (-not $volume) { throw "Could not locate thumbnails_data for project $project." }

$databaseFile = Join-Path $folder "database.sql"
docker compose exec -T postgres pg_dump -U ($env:POSTGRES_USER ?? "videocat") -d ($env:POSTGRES_DB ?? "videocat") | Out-File -Encoding utf8 $databaseFile
Compress-Archive -Path $databaseFile -DestinationPath (Join-Path $folder "database.sql.zip") -Force
Remove-Item $databaseFile
docker run --rm -v "${volume}:/source:ro" -v "${((Resolve-Path $folder).Path)}:/backup" alpine:3.21 tar -C /source -czf /backup/thumbnails.tar.gz .
if (Test-Path .env) { Copy-Item .env (Join-Path $folder ".env") }
Get-ChildItem $folder -File | Get-FileHash -Algorithm SHA256 | ForEach-Object { "$(Split-Path $_.Path -Leaf)  $($_.Hash)" } | Set-Content (Join-Path $folder "SHA256SUMS.txt")
Write-Host "Backup created: $folder"
