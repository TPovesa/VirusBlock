@echo off
curl.exe -fsSL https://sosiskibot.ru/neuralv/install/nv.cmd -o "%TEMP%\nv-install.cmd"
if errorlevel 1 exit /b 1
call "%TEMP%\nv-install.cmd"
if errorlevel 1 exit /b 1
set "PATH=%LOCALAPPDATA%\NV;%PATH%"
nv -v
if errorlevel 1 exit /b 1
nv install @lvls/neuralv
