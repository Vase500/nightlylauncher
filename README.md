# 🌙 Nightly Launcher

A modern Minecraft launcher focused on **instances, modpacks, mods, and easy Minecraft management**.

Nightly Launcher is a passion project developed by me with the help of **ChatGPT** and **OpenCode**. The project is currently maintained as a personal project, and while future plans aren't guaranteed, I'll do my best to keep Nightly Launcher updated and supported.

> 🚧 **Nightly Launcher is an actively developed project.** Features, design, and functionality may change as development continues.

## 💻 System Requirements

* **Windows** — Windows 10 or later (64-bit)
* **Linux** — Ubuntu 20.04+ / Debian 10+ / Fedora 34+ (glibc 2.28+), plus any Arch-based distro
* **RAM** — 4 GB recommended (the launcher itself is lightweight; Minecraft needs more)
* **Java** — not required; the launcher downloads the right runtime automatically on first launch

## ✨ Features

### 🎮 Instances

* Create, edit, delete, and launch Minecraft instances
* Per-instance RAM allocation and JVM arguments
* Custom resolution and fullscreen settings
* Instance icons
* Playtime tracking

### 📦 Modpacks

* Modrinth browsing and searching
* CurseForge browsing and searching
* Filters for releases, snapshots, betas, and alphas
* One-click modpack installation
* `.mrpack` imports
* CurseForge ZIP imports
* Prism Launcher-style ZIP imports
* Configurable download location

### 🧩 Mods

* Per-instance mod management
* Install mods from files, URLs, Modrinth, and CurseForge
* Minecraft-version-aware mod filtering
* Mod metadata extracted from JAR files
* Mod icons and descriptions
* Open the instance mods folder
* Remove installed mods

### 🛠️ Minecraft Versions & Loaders

* Vanilla
* Fabric
* Quilt
* Forge
* NeoForge
* Minecraft releases
* Snapshots
* Beta versions
* Alpha versions
* Experimental versions

### ☕ Java

* Automatic Java runtime downloads
* Adoptium runtimes
* Oracle runtimes
* Mojang runtimes
* Automatic Java detection
* Per-launcher Java path
* Download Java directly from the launcher

### 👤 Accounts

* Microsoft account login
* Offline mode
* Account switching
* 3D skin preview
* Skin presets

### 🐧 Linux Gaming

* Feral GameMode support
* MangoHud support
* Discrete GPU support
* DRI_PRIME support
* NVIDIA PRIME offloading

### ⬇️ Automatic Updates

* Automatic update checking
* GitHub Releases integration
* One-click updates
* Automatic relaunch after updating
* Skip-version support
* Enable/disable automatic update checks

### 🎨 Appearance & Customization

* Light, dark, and system themes
* Custom accent colors
* Splash screen
* Custom RAM warnings
* Automatic Java download settings

### 📦 Platforms & Packaging

* Windows 10/11
* Linux
* `.exe`
* `.AppImage`
* `.deb`
* `.rpm`
* `.pacman`

---

## 🛠️ Built With

* **Electron**
* **Vanilla JavaScript**
* **HTML**
* **CSS**
* **Node.js**
* **skinview3d**

## 💾 Installation

Download the latest version from the **[Releases](../../releases)** page.

### Windows

Run the `Nightly Launcher Setup 1.0.0.exe` installer and follow the setup wizard.

### Linux

Nightly Launcher is available in several formats:

* **AppImage** — Portable version. If it won't launch on a fresh distro (FUSE missing), run it with `--appimage-extract-and-run`.
* **`.deb`** — Ubuntu, Debian, and other Debian-based distributions
* **`.rpm`** — Fedora, RHEL, and other RPM-based distributions
* **`.pacman`** — Arch Linux and Arch-based distributions

The launcher can automatically download the required Java runtime when launching Minecraft, so a separate Java installation is not required.

## 🚀 Development

Clone the repository:

```bash
git clone https://github.com/Vase500/nightlylauncher.git
cd nightlylauncher
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

Build the Windows installer:

```bash
npm run dist
```

Build Linux packages (AppImage, deb, rpm, pacman):

```bash
./build-ubuntu.sh
```

> **Note:** Linux packages should be built on a Linux system for the best compatibility (WSL2 works too). The build script auto-installs missing dependencies and Node.js.

## 🗺️ Roadmap

This roadmap outlines the planned development of Nightly Launcher. Features and priorities may change as development continues.

### ✅ v1.0.0 — Initial Release

* [x] Minecraft instance management
  * [x] Create, edit, delete, and launch instances
  * [x] Per-instance RAM, JVM arguments, resolution, and fullscreen settings
  * [x] Instance icons
  * [x] Playtime tracking
* [x] Modpack support
  * [x] Modrinth browsing and installation
  * [x] CurseForge browsing and installation
  * [x] `.mrpack` imports
  * [x] CurseForge ZIP imports
  * [x] Prism Launcher-style ZIP imports
  * [x] Configurable download location
* [x] Mod management
  * [x] Install mods from files, URLs, Modrinth, and CurseForge
  * [x] Per-instance mod management
  * [x] Mod metadata and icons
  * [x] Minecraft-version-aware filtering
* [x] Minecraft versions and loaders
  * [x] Vanilla
  * [x] Fabric
  * [x] Quilt
  * [x] Forge
  * [x] NeoForge
  * [x] Release, snapshot, beta, alpha, and experimental versions
* [x] Java management
  * [x] Automatic Java downloads
  * [x] Adoptium, Oracle, and Mojang runtimes
  * [x] Automatic Java detection
  * [x] Per-launcher Java path
* [x] Account management
  * [x] Microsoft accounts
  * [x] Offline mode
  * [x] Account switching
  * [x] 3D skin preview
  * [x] Skin presets
* [x] Linux gaming features
  * [x] Feral GameMode
  * [x] MangoHud
  * [x] Discrete GPU support
* [x] Automatic updates
* [x] Light/dark/system themes
* [x] Custom accent colors
* [x] Splash screen
* [x] RAM warnings
* [x] Automatic Java download options
* [x] Windows and Linux packaging

### 🚧 v1.x — Polish & Improvements

* [ ] Updated launcher UI
* [ ] Improved UI/UX
* [ ] Improved instance management
* [ ] Improved modpack installation
* [ ] Improved download management
* [ ] Better download progress information
* [ ] Improved error handling and crash reporting
* [ ] Better logging and diagnostic tools
* [ ] Improved performance and memory usage
* [ ] More launcher customization
* [ ] Improved account management
* [ ] Better documentation and support
* [ ] Improved Linux compatibility
* [ ] Improved Windows compatibility

### 🔜 v2.0 — Advanced Features

* [ ] Resource pack management
* [ ] Shader management
* [ ] Screenshot management
* [ ] World management
* [ ] Server management
* [ ] Advanced instance cloning
* [ ] Instance backup and restore
* [ ] Instance export/import
* [ ] Modpack creation tools
* [ ] Modpack updating
* [ ] Modpack version switching
* [ ] Advanced Java management
* [ ] More detailed game statistics
* [ ] Advanced launch configuration

### 🌙 Long-Term Goals

* [ ] Built-in launcher news/changelog
* [ ] Community modpack discovery
* [ ] Improved skin management
* [ ] Custom launcher themes
* [ ] Plugin/extension system
* [ ] Community integrations
* [ ] Additional Linux package formats
* [ ] Support for additional Minecraft platforms where practical
* [ ] Cloud-based instance synchronization
* [ ] Optional cloud backups
* [ ] Advanced performance tools

> **Note:** The roadmap is a general development plan and does not guarantee that every listed feature will be implemented. Priorities may change based on development requirements, technical limitations, and community feedback.

## 📄 License

Nightly Launcher is released under the [MIT License](LICENSE).

**Nightly Launcher** — One launcher. All your Minecraft instances. 🌙
