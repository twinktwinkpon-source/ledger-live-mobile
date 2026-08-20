@echo off
REM ─── FLEX License Server — install as Windows service ───
REM Run this file as ADMINISTRATOR on the VPS.
REM It downloads nssm (if missing) and registers the server as a service
REM that starts automatically and survives reboots / RDP logout.

SETLOCAL
SET SERVICE_NAME=flex-server
SET SRV_DIR=C:\Users\Administrator\Desktop\flex-server
SET NODE_EXE=C:\Program Files\nodejs\node.exe
SET NSSM_EXE=%SRV_DIR%\nssm.exe

REM 1) Get nssm if not present
if not exist "%NSSM_EXE%" (
  echo Downloading nssm...
  powershell -Command "Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile '%SRV_DIR%\nssm.zip'"
  powershell -Command "Expand-Archive -Path '%SRV_DIR%\nssm.zip' -DestinationPath '%SRV_DIR%\nssm_tmp' -Force"
  move "%SRV_DIR%\nssm_tmp\nssm-2.24\win64\nssm.exe" "%NSSM_EXE%"
  rmdir /s /q "%SRV_DIR%\nssm_tmp"
  del "%SRV_DIR%\nssm.zip"
)

REM 2) Register / update the service
echo Installing service %SERVICE_NAME%...
"%NSSM_EXE%" stop %SERVICE_NAME% 2>nul
"%NSSM_EXE%" remove %SERVICE_NAME% confirm 2>nul
"%NSSM_EXE%" install %SERVICE_NAME% "%NODE_EXE%" "%SRV_DIR%\index.js"
"%NSSM_EXE%" set %SERVICE_NAME% AppDirectory "%SRV_DIR%"
"%NSSM_EXE%" set %SERVICE_NAME% DisplayName "FLEX License Server"
"%NSSM_EXE%" set %SERVICE_NAME% Description "FLEX license/balance server (port 9000)"
"%NSSM_EXE%" set %SERVICE_NAME% Start SERVICE_AUTO_START
"%NSSM_EXE%" set %SERVICE_NAME% AppExit Default Restart
"%NSSM_EXE%" set %SERVICE_NAME% AppNoConsole 1

REM 3) Start it
"%NSSM_EXE%" start %SERVICE_NAME%

echo.
echo Done. Verify with:  sc query %SERVICE_NAME%
pause
