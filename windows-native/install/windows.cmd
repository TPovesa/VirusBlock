@echo off
setlocal
set "BASE_URL=%NEURALV_BASE_URL%"
if not defined BASE_URL set "BASE_URL=https://neuralvv.org"
if "%BASE_URL:~-1%"=="/" set "BASE_URL=%BASE_URL:~0,-1%"
set "NV_SCRIPT=%BASE_URL%/install/nv.cmd"
set "NV_WRAPPER=%LOCALAPPDATA%\NV\nv.cmd"
set "NV_EXE=%LOCALAPPDATA%\NV\nv.exe"
curl.exe -fsSL "%NV_SCRIPT%" -o "%TEMP%\nv-install.cmd" || exit /b 1
call "%TEMP%\nv-install.cmd" || exit /b 1
if exist "%NV_WRAPPER%" (
  call "%NV_WRAPPER%" install @lvls/neuralv
) else if exist "%NV_EXE%" (
  "%NV_EXE%" install @lvls/neuralv
) else (
  echo NV установлен некорректно: nv.exe не найден
  exit /b 1
)
endlocal
