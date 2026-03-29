$ErrorActionPreference = 'Stop'
$baseUrl = if ([string]::IsNullOrWhiteSpace($env:NEURALV_BASE_URL)) { 'https://neuralvv.org' } else { $env:NEURALV_BASE_URL.TrimEnd('/') }
$nvScript = "$baseUrl/install/nv.ps1"
$nvCmdWrapper = Join-Path $env:LOCALAPPDATA 'NV\nv.cmd'
$nvExe = Join-Path $env:LOCALAPPDATA 'NV\nv.exe'
Invoke-RestMethod $nvScript | Invoke-Expression
if (Test-Path $nvCmdWrapper) {
  & $nvCmdWrapper install @lvls/neuralv
} elseif (Test-Path $nvExe) {
  & $nvExe install @lvls/neuralv
} else {
  throw 'NV установлен некорректно: nv.exe не найден'
}
