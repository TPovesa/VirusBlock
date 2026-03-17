$ErrorActionPreference = 'Stop'

irm https://sosiskibot.ru/neuralv/install/nv.ps1 | iex
$env:Path = "$env:LOCALAPPDATA\NV;$env:Path"
nv -v
nv install @lvls/neuralv
