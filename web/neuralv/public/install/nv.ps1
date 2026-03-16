$ErrorActionPreference = 'Stop'

$repo = 'Perdonus/NV'
$rawBase = "https://raw.githubusercontent.com/$repo/windows-builds"
$manifest = Invoke-RestMethod "$rawBase/manifest.json"
$artifact = $manifest.artifacts | Where-Object { $_.platform -eq 'nv-windows' } | Select-Object -First 1
if (-not $artifact -or -not $artifact.download_url) {
  throw 'nv-windows artifact not found'
}

$installRoot = Join-Path $env:LOCALAPPDATA 'NV'
$target = Join-Path $installRoot 'nv.exe'
$wrapper = Join-Path $installRoot 'nv.cmd'
$tempTarget = Join-Path $installRoot 'nv.download.exe'

function Ensure-PathEntry {
  param([string]$PathEntry)

  $currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $currentPath) {
    [Environment]::SetEnvironmentVariable('Path', $PathEntry, 'User')
    return
  }

  $parts = $currentPath.Split(';') | Where-Object { $_ -and $_.Trim() }
  if ($parts -contains $PathEntry) {
    return
  }

  [Environment]::SetEnvironmentVariable('Path', "$currentPath;$PathEntry", 'User')
}

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
if (Test-Path $tempTarget) {
  Remove-Item -Force $tempTarget
}

Invoke-WebRequest -Uri $artifact.download_url -OutFile $tempTarget
Move-Item -Force $tempTarget $target

@(
  '@echo off'
  """$target"" %*"
) | Set-Content -Path $wrapper -Encoding ASCII

Ensure-PathEntry -PathEntry $installRoot

Write-Host "Установлен или обновлён nv в $target"
Write-Host "Команда nv доступна после перезапуска терминала."
