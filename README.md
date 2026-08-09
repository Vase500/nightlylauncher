# Nightly Launcher

A modern Electron-based Minecraft launcher with modpack support.

## Features

- Vanilla, Fabric, Quilt, NeoForge and Forge instance support
- Modrinth, CurseForge and Prism-style modpack importing
- Microsoft / offline accounts with 3D skin preview
- Auto-downloads Java (Adoptium, Oracle, Mojang runtimes)
- Playtime tracking, custom RAM and JVM args, custom icons
- Frameless, transparent, glow-outlined window (Windows 11-style controls)

## Running

```bash
npm install
npm start
```

## Building

Windows installer:

```bash
npm run dist
```

Linux (AppImage / deb / rpm) — build on a Linux machine:

```bash
npm run dist:linux
npx electron-builder --linux AppImage deb rpm
```

Arch Linux: use the included `PKGBUILD` with `makepkg`.

## Requirements

- Node.js 18+ and npm
- Java is downloaded automatically by the launcher when needed

## License

MIT
