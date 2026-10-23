# VideoCAT drive health collector. smart-setup.ps1 installs it in Program Files, next to
# smartctl.exe, and the scheduled task "\VideoCAT\Salud de discos" runs it with the highest
# privileges, which SMART needs. It reads every drive with smartctl and writes one JSON file that
# the Companion (not elevated) reads: ProgramData\VideoCAT\smart\smart.json.
$ErrorActionPreference = 'Stop'
$dataDir = Join-Path $env:ProgramData 'VideoCAT\smart'
$smartctl = Join-Path $PSScriptRoot 'smartctl.exe'

# Only into the folder setup created for it, never through a link someone could put in its place.
foreach ($folder in @((Split-Path $dataDir -Parent), $dataDir)) {
  $item = Get-Item -LiteralPath $folder -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "$folder es un enlace; no se escribe en él." }
}

function Read-Smartctl([string[]]$Arguments) {
  # smartctl's exit code is a bit mask (bit 6: errors in the drive's log, and so on); its JSON is
  # what counts.
  $output = & $smartctl @Arguments 2>$null
  return ($output -join "`n")
}

$scan = Read-Smartctl @('--scan-open', '--json=c') | ConvertFrom-Json
$disks = @()
foreach ($device in @($scan.devices)) {
  $name = [string]$device.name
  $type = [string]$device.type
  if (-not $name -or $name -notmatch '^/dev/[a-z0-9]+$' -or $type -notmatch '^[a-z0-9,_+-]*$') { continue }
  $arguments = @('-x', '--json=c')
  if ($type) { $arguments += @('-d', $type) }
  $arguments += $name
  # /dev/sda is PhysicalDrive0, /dev/sdb PhysicalDrive1, ... /dev/sdaa PhysicalDrive26.
  $diskNumber = $null
  if ($name -match '^/dev/sd([a-z]+)$') {
    $letters = $Matches[1]
    $diskNumber = if ($letters.Length -eq 1) { [int][char]$letters[0] - 97 } else { ([int][char]$letters[0] - 96) * 26 + ([int][char]$letters[1] - 97) }
  }
  $disks += [ordered]@{ device = $name; diskNumber = $diskNumber; report = (Read-Smartctl $arguments) }
}

$volumes = @(Get-Partition | Where-Object { $_.DriveLetter } | ForEach-Object {
  [ordered]@{ driveLetter = [string]$_.DriveLetter; diskNumber = [int]$_.DiskNumber }
})
$physicalDisks = @(Get-Disk | ForEach-Object {
  [ordered]@{ number = [int]$_.Number; serialNumber = if ($_.SerialNumber) { ([string]$_.SerialNumber).Trim() } else { $null } }
})

$result = [ordered]@{
  collectedAt = (Get-Date).ToUniversalTime().ToString('o')
  volumes = $volumes
  physicalDisks = $physicalDisks
  disks = $disks
}
# Written whole and then renamed, so the Companion never reads half a file.
$json = $result | ConvertTo-Json -Depth 6 -Compress
$temporary = Join-Path $dataDir 'smart.json.tmp'
[IO.File]::WriteAllText($temporary, $json, (New-Object Text.UTF8Encoding $false))
Move-Item -LiteralPath $temporary -Destination (Join-Path $dataDir 'smart.json') -Force
