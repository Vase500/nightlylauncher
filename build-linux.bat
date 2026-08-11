@echo off
title Nightly Launcher - Linux Build
echo ==========================================
echo  Building Nightly Launcher Linux packages
echo  (AppImage, deb, rpm, pacman) via WSL2
echo ==========================================
echo.

if not exist "%USERPROFILE%\Documents\Default Project" (
  echo ERROR: Project folder not found.
  echo Expected: %USERPROFILE%\Documents\Default Project
  pause
  exit /b 1
)

echo [1/2] Syncing source to WSL...
wsl -d Ubuntu-24.04 -u veksa -- /home/veksa/nightly-launcher/sync.sh

echo [2/2] Building in WSL...
wsl -d Ubuntu-24.04 -u veksa --cd /home/veksa/nightly-launcher -- ./build-ubuntu.sh

echo.
if %errorlevel% neq 0 (
  echo BUILD FAILED
) else (
  echo Build complete. Copying packages to dist\linux on Windows...
  if not exist "%USERPROFILE%\Documents\Default Project\dist\linux" mkdir "%USERPROFILE%\Documents\Default Project\dist\linux"
  wsl -d Ubuntu-24.04 -u veksa -- bash -lc "cp -f /home/veksa/nightly-launcher/dist/*.AppImage /home/veksa/nightly-launcher/dist/*.deb /home/veksa/nightly-launcher/dist/*.rpm /home/veksa/nightly-launcher/dist/*.pacman '/mnt/c/Users/Veksa/Documents/Default Project/dist/linux/'"
  echo Packages are in:
  echo   %USERPROFILE%\Documents\Default Project\dist\linux
)
echo.
pause
