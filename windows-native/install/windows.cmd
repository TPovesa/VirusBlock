@echo off
setlocal
set "NV_SCRIPT=https://raw.githubusercontent.com/Perdonus/NV/windows-builds/nv.cmd"
set "NV_WRAPPER=%LOCALAPPDATA%\NV\nv.cmd"
set "NV_EXE=%LOCALAPPDATA%\NV\nv.exe"
curl.exe -fsSL "%NV_SCRIPT%" -o "%TEMP%\nv-install.cmd" || exit /b 1
call "%TEMP%\nv-install.cmd" || exit /b 1
if exist "%NV_WRAPPER%" (
  call "%NV_WRAPPER%" install neuralv@latest
) else if exist "%NV_EXE%" (
  "%NV_EXE%" install neuralv@latest
) else (
  echo NV установлен некорректно: nv.exe не найден
  exit /b 1
)
