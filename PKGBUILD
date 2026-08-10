# Maintainer: Vase 500
pkgname=nightly-launcher
pkgver=1.0.0
pkgrel=1
pkgdesc="A modern Electron-based Minecraft launcher"
arch=('x86_64')
license=('MIT')
depends=('gtk3' 'nss' 'libnotify' 'xdg-utils')
makedepends=('nodejs' 'npm')
source=("nightly-launcher-$pkgver.tar.gz")
sha256sums=('SKIP')
options=('!strip')

build() {
  cd "nightly-launcher-$pkgver"
  npm install --no-audit --no-fund
  npx electron-builder --linux dir
}

package() {
  cd "nightly-launcher-$pkgver"
  install -d "$pkgdir/opt/nightly-launcher"
  cp -a dist/linux-unpacked/. "$pkgdir/opt/nightly-launcher/"
  install -Dm644 icon2.png "$pkgdir/usr/share/icons/hicolor/512x512/apps/nightly-launcher.png"
  mkdir -p "$pkgdir/usr/share/applications" "$pkgdir/usr/bin"
  printf '%s\n' \
    '[Desktop Entry]' \
    'Name=Nightly Launcher' \
    'Comment=A modern Electron-based Minecraft launcher' \
    'Exec=/opt/nightly-launcher/nightly-launcher %U' \
    'Icon=nightly-launcher' \
    'Type=Application' \
    'Categories=Game;' \
    'StartupWMClass=nightly-launcher' \
    > "$pkgdir/usr/share/applications/nightly-launcher.desktop"
  ln -s /opt/nightly-launcher/nightly-launcher "$pkgdir/usr/bin/nightly-launcher"
}
