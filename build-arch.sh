#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "==> Install base tools + Node (needs sudo)"
sudo pacman -S --needed --noconfirm base-devel git nodejs npm

echo "==> Packaging source tarball for makepkg"
rm -f nightly-launcher-1.0.0.tar.gz
tar czf nightly-launcher-1.0.0.tar.gz --exclude node_modules --exclude dist .

echo "==> Building Arch package"
makepkg -si

echo
echo "==> Done:"
ls -lh nightly-launcher-*.pkg.tar.zst
