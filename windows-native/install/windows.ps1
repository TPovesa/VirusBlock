$ErrorActionPreference = 'Stop'
$nvScript = 'https://raw.githubusercontent.com/Perdonus/NV/windows-builds/nv.ps1'
$nvCmdWrapper = Join-Path $env:LOCALAPPDATA 'NV\nv.cmd'
$nvExe = Join-Path $env:LOCALAPPDATA 'NV\nv.exe'
Invoke-RestMethod $nvScript | Invoke-Expression
if (Test-Path $nvCmdWrapper) {
  & $nvCmdWrapper install neuralv@latest
} elseif (Test-Path $nvExe) {
  & $nvExe install neuralv@latest
} else {
  throw 'NV установлен некорректно: nv.exe не найден'
}
