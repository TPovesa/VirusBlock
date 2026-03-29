@echo off
setlocal
set "BASE_URL=%NEURALV_BASE_URL%"
if not defined BASE_URL set "BASE_URL=https://neuralvv.org"
if "%BASE_URL:~-1%"=="/" set "BASE_URL=%BASE_URL:~0,-1%"
set "NV_URL=%NV_DOWNLOAD_URL%"
if not defined NV_URL set "NV_URL=%BASE_URL%/basedata/api/releases/download?platform=nv-windows"
set "INSTALL_ROOT=%LOCALAPPDATA%\NV"
set "TARGET=%INSTALL_ROOT%\nv.exe"
set "WRAPPER=%INSTALL_ROOT%\nv.cmd"
set "TMP_TARGET=%INSTALL_ROOT%\nv.download.exe"
if not exist "%INSTALL_ROOT%" mkdir "%INSTALL_ROOT%" >nul 2>&1
if exist "%TMP_TARGET%" del /f /q "%TMP_TARGET%" >nul 2>&1
curl.exe -fsSL "%NV_URL%" -o "%TMP_TARGET%" || exit /b 1
move /y "%TMP_TARGET%" "%TARGET%" >nul || exit /b 1
> "%WRAPPER%" echo @echo off
>> "%WRAPPER%" echo "%TARGET%" %%*
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$entry='%INSTALL_ROOT%';" ^
  "$userPath=[Environment]::GetEnvironmentVariable('Path','User');" ^
  "$parts=@(); if ($userPath) { $parts=$userPath.Split(';',[System.StringSplitOptions]::RemoveEmptyEntries) };" ^
  "$exists=$false; foreach ($part in $parts) { if ($part.TrimEnd('\') -ieq $entry.TrimEnd('\')) { $exists=$true; break } };" ^
  "if (-not $exists) { [Environment]::SetEnvironmentVariable('Path', (($entry) + ';' + $userPath).Trim(';'),'User') }" || exit /b 1
set "PATH=%INSTALL_ROOT%;%PATH%"
"%TARGET%" -v > "%TEMP%\nv-version.txt" 2>&1 || (
  type "%TEMP%\nv-version.txt"
  exit /b 1
)
echo NV установлен: %TARGET%
type "%TEMP%\nv-version.txt"
endlocal
