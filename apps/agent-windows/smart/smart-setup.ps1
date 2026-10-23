# Turns VideoCAT's drive health check on or off. The Companion runs it elevated (UAC), once:
#   smart-setup.ps1 -Source <folder with smartctl.exe, drivedb.h, COPYING.txt, smart-collect.ps1> -UserSid <SID>
#   smart-setup.ps1 -Remove
# The task it creates runs with the highest privileges, so everything it runs lives where only
# administrators can write: smartctl and the collector in Program Files, the results folder with
# its own permissions. The Companion's own folder (in the user profile) is never run elevated.
# It writes nothing outside them either (a log in the user's folders could be redirected to a
# system file by a link): each failure is its own exit code, which the Companion explains.
param([string]$Source, [string]$UserSid, [switch]$Remove)
$ErrorActionPreference = 'Stop'
# Each failure also goes to standard error (seen when run directly, as in CI; never a file).
trap { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }

$installDir = Join-Path $env:ProgramFiles 'VideoCAT SMART'
$parentDir = Join-Path $env:ProgramData 'VideoCAT'
$dataDir = Join-Path $parentDir 'smart'
$taskPath = '\VideoCAT\'
$taskName = 'Salud de discos'
# smartctl.exe from smartmontools 7.5 (GPG-signed release), as fetch-smartctl.mjs packs it.
$smartctlSha256 = 'B5DB94E5082C042BE44994B7A4FA8F7B5C8E713B2AB1C9A560D8F7A7995EA27D'
$installedFiles = @('smartctl.exe', 'drivedb.h', 'COPYING.txt', 'smart-collect.ps1')

# A folder, or a link a user planted where it should be: the link itself goes, never what it
# points to.
function Remove-Folder([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { [IO.Directory]::Delete($Path, $false) }
  else { Remove-Item -LiteralPath $Path -Recurse -Force }
}

# Administrators and SYSTEM may change it; users may only read.
function Protect-Folder([string]$Path) {
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  $none = [Security.AccessControl.PropagationFlags]::None
  $administrators = New-Object Security.Principal.SecurityIdentifier 'S-1-5-32-544'
  foreach ($rule in @(
    @($administrators, 'FullControl'),
    @((New-Object Security.Principal.SecurityIdentifier 'S-1-5-18'), 'FullControl'),
    @((New-Object Security.Principal.SecurityIdentifier 'S-1-5-32-545'), 'ReadAndExecute')
  )) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($rule[0], $rule[1], $inherit, $none, 'Allow')))
  }
  $acl.SetOwner($administrators)
  Set-Acl -LiteralPath $Path -AclObject $acl
}

Unregister-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
if ($Remove) {
  Remove-Folder $installDir
  Remove-Folder $dataDir
  if ((Test-Path -LiteralPath $parentDir) -and -not (Get-ChildItem -LiteralPath $parentDir -Force)) { Remove-Folder $parentDir }
  exit 0
}

if ($UserSid -notmatch '^S-1-5-21-\d+-\d+-\d+-\d+$') { exit 10 }
$account = (New-Object Security.Principal.SecurityIdentifier $UserSid).Translate([Security.Principal.NTAccount]).Value
if ((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $Source 'smartctl.exe')).Hash -ne $smartctlSha256) { exit 11 }

Remove-Folder $installDir
New-Item -ItemType Directory -Path $installDir | Out-Null
foreach ($file in $installedFiles) { Copy-Item -LiteralPath (Join-Path $Source $file) -Destination $installDir }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $installDir 'smartctl.exe')).Hash -ne $smartctlSha256) {
  Remove-Folder $installDir
  exit 11
}

# ProgramData lets users create folders, so both are made here, fresh, with their own permissions.
if ((Test-Path -LiteralPath $parentDir) -and ((Get-Item -LiteralPath $parentDir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { Remove-Folder $parentDir }
if (-not (Test-Path -LiteralPath $parentDir)) { New-Item -ItemType Directory -Path $parentDir | Out-Null }
Protect-Folder $parentDir
Remove-Folder $dataDir
New-Item -ItemType Directory -Path $dataDir | Out-Null
Protect-Folder $dataDir

$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$installDir\smart-collect.ps1`""
# S4U: runs without a window and without the user's password; Highest: with the administrator
# token SMART needs.
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType S4U -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew -StartWhenAvailable
try {
  Register-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Action $action -Principal $principal -Settings $settings `
    -Description 'VideoCAT: lee la salud (SMART) de los discos con smartctl. La inicia el Companion.' | Out-Null
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 12 }

try {
  # The Companion (the same user, not elevated) may start the task and read it; nothing else.
  $service = New-Object -ComObject 'Schedule.Service'
  $service.Connect()
  $task = $service.GetFolder($taskPath).GetTask($taskName)
  $task.SetSecurityDescriptor("D:P(A;;FA;;;BA)(A;;FA;;;SY)(A;;GRGX;;;$UserSid)", 0)
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 13 }
exit 0
