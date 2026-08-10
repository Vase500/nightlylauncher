#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "==> Installing system dependencies (needs sudo)"
sudo apt update
sudo apt install -y curl rpm fakeroot dpkg-dev libfuse2t64 libfuse2 2>/dev/null || \
  sudo apt install -y curl rpm fakeroot dpkg-dev

echo "==> Ensuring Node.js (LTS 22)"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
fi
node -v
npm -v

echo "==> Installing npm dependencies"
npm install --no-audit --no-fund

echo "==> Building AppImage + deb + rpm"
npx electron-builder --linux AppImage deb rpm

echo
echo "==> Done. Artifacts:"
ls -lh dist/*.AppImage dist/*.deb dist/*.rpm 2>/dev/null || true
echo
echo "Run the AppImage (no install):"
echo "  ./dist/Nightly\ Launcher-1.0.0.AppImage --appimage-extract-and-run"
echo "Install the deb:"
echo "  sudo apt install ./dist/Nightly\ Launcher-1.0.0.deb"
echo "Install the rpm (on RPM distros):"
echo "  sudo dnf install ./dist/Nightly\ Launcher-1.0.0.rpm"
