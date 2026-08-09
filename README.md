# 🌙 Nightly Launcher

A modern Minecraft launcher focused on modpacks, mods, instances, and easy Minecraft management.
This launcher has been made by me using the help of ChatGPT and OpenCode. Nightly Launcher is for now a passion project made by me so for now,
nothing is confirmed for the future of the launcher, but i will try my best to keep it alive.

> 🚧 **Nightly Launcher is currently in development.** Features and design may change frequently.

## ✨ Features

* 🎮 Minecraft instance management
* 📦 Modpack support (Modrinth, CurseForge, and Prism-style imports)
* 🧩 Mod management
* 🛠️ Fabric, Forge, NeoForge, and Quilt support
* ☕ Java management (auto-downloads Adoptium, Oracle, or Mojang runtimes)
* 💾 Custom RAM allocation and JVM arguments
* 👤 Minecraft account management (Microsoft + offline, with 3D skin preview)
* ⏱️ Playtime tracking
* 🎨 Modern and customizable interface
* ⬇️ Automatic Minecraft and modpack downloads
* 🚀 Fast and simple launching

## 🛠️ Built With

* Electron
* Vanilla JavaScript, HTML, and CSS
* Node.js
* skinview3d

## 💾 Installation

Grab the latest build from the **Releases** page:

* **Windows** — `Nightly Launcher Setup .exe`
* **Linux** — AppImage (portable), `.deb`, or `.rpm`
* **Arch Linux** — build from the included `PKGBUILD` with `makepkg`

The launcher downloads Java automatically when you first launch a game, so no separate Java install is required.

## 🚀 Development

Clone the repository:

```bash
git clone https://github.com/vase500/nightly-launcher.git
cd nightly-launcher
```

Install dependencies:

```bash
npm install
```

Start the development environment:

```bash
npm run dev
```

### Building

Windows installer:

```bash
npm run dist
```

Linux (AppImage / deb / rpm — build on a Linux machine):

```bash
npx electron-builder --linux AppImage deb rpm
```

## 📁 Project Status

Nightly Launcher is currently in the early development stage.

### Roadmap

* [x] Linux Support (.deb, .rpm, .appimage)
* [x] First release of Nightly Launcher
* [ ] Updated Launcher UI
* [ ] Automatic updates
* [ ] Additional generally needed features
* [ ] Better support for the launcher

## 📄 License

Nightly Launcher is released under the [MIT License](LICENSE).

**Nightly Launcher** — One launcher. All your Minecraft instances. 🌙
