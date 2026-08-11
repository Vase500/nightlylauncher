'use strict'
const path = require('path')
const fs = require('fs')
const { spawn, execFile } = require('child_process')
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const paths = require('./core/paths')
const config = require('./core/config')
const instances = require('./core/instances')
const mojang = require('./core/mojang')
const loaders = require('./core/loaders')
const launcher = require('./core/launcher')
const importers = require('./core/importers')
const modrinth = require('./core/modrinth')
const curseforge = require('./core/curseforge')
const mods = require('./core/mods')
const java = require('./core/java')
const accounts = require('./core/accounts')
const auth = require('./core/auth')
const skins = require('./core/skins')
const updates = require('./core/updates')
const util = require('./core/util')
const native = require('./core/native')

app.setName('Nightly Launcher')
app.setAppUserModelId('com.nightly.launcher')

const appIcon = path.join(__dirname, 'icon.png')

let mainWindow = null
let splashWindow = null
const splashStart = Date.now()

function createSplash () {
  splashWindow = new BrowserWindow({
    width: 540,
    height: 540,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    icon: appIcon,
    webPreferences: { contextIsolation: true }
  })
  splashWindow.setMenu(null)
  splashWindow.loadFile(path.join(__dirname, 'splash.html'))
}

function createMain () {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    transparent: true,
    show: false,
    hasShadow: false,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow.setMenu(null)
  mainWindow.loadFile(path.join(__dirname, 'index.html'))
  mainWindow.once('ready-to-show', () => {
    const elapsed = Date.now() - splashStart
    setTimeout(() => {
      if (mainWindow) mainWindow.show()
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close()
    }, Math.max(0, 3000 - elapsed))
  })
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.on('maximize', () => send('window:maximized', true))
  mainWindow.on('unmaximize', () => send('window:maximized', false))
}

function send (channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function sendProgress (instanceId) {
  return (p) => send('launch:progress', { instanceId, progress: p })
}

function sendLog (instanceId) {
  return (tag, line) => {
    try {
      const logDir = path.join(instances.gameDir(instanceId), 'logs')
      fs.mkdirSync(logDir, { recursive: true })
      fs.appendFileSync(path.join(logDir, 'nightly.log'), `[${new Date().toISOString()}] [${tag}] ${line}\n`)
    } catch {}
    send('launch:log', { instanceId, tag, line })
  }
}

function sendExit (instanceId) {
  return (info) => send('launch:exit', { instanceId, info })
}

/* ---------------- cancellable installs ---------------- */

const installJobs = new Map()

function beginInstall (jobId) {
  const controller = new AbortController()
  const job = {
    signal: controller.signal,
    progress: (p) => { if (!controller.signal.aborted) send('import:progress', p) }
  }
  installJobs.set(jobId, job)
  return job
}

function endInstall (jobId) {
  installJobs.delete(jobId)
}

function installWrapper (jobId, run) {
  const job = jobId ? beginInstall(jobId) : { signal: undefined, progress: (p) => send('import:progress', p) }
  return (async () => {
    try {
      return await run(job)
    } catch (e) {
      if (jobId && job.signal.aborted && !(e && e.cancelled)) {
        const ce = new Error('Install cancelled')
        ce.cancelled = true
        throw ce
      }
      throw e
    } finally {
      if (jobId) endInstall(jobId)
    }
  })()
}

ipcMain.handle('install:cancel', (e, jobId) => {
  const job = installJobs.get(jobId)
  if (!job) return false
  job.signal.abort()
  return true
})

/* ---------------- IPC ---------------- */

ipcMain.handle('config:get', () => config.load())
ipcMain.handle('config:set', (e, patch) => config.save(patch))
ipcMain.handle('app:version', () => app.getVersion())

/* ---------------- updates ---------------- */

let updateCache = null
let updateCacheAt = 0
const UPDATE_TTL = 5 * 60 * 1000

async function checkUpdates (force) {
  if (!force && updateCache && Date.now() - updateCacheAt < UPDATE_TTL) return updateCache
  let info
  try {
    info = await updates.check(app.getVersion())
    info.ok = true
  } catch (err) {
    info = { current: app.getVersion(), latest: null, hasUpdate: false, downloadUrl: null, downloadName: null, downloadSize: 0, source: null, ok: false, error: err.message }
  }
  updateCache = info
  updateCacheAt = Date.now()
  config.save({ lastUpdateCheck: Date.now(), lastUpdateVersion: info.latest || '' })
  return info
}

ipcMain.handle('updates:check', (e, force) => checkUpdates(!!force))

function runInstall (install) {
  return new Promise(resolve => {
    execFile(install.cmd, install.args, { windowsHide: true }, err => {
      resolve(err ? (err.code !== undefined ? err.code : 1) : 0)
    })
  })
}

function spawnDetached (file, args) {
  try {
    const child = spawn(file, args, { detached: true, stdio: 'ignore' })
    child.unref()
    return child
  } catch { return null }
}

function relaunchExe () {
  if (process.platform === 'win32') {
    const exec = String(process.execPath || '').toLowerCase()
    if (exec.includes('\\programs\\') || exec.includes('\\program files\\')) return process.execPath
    const base = path.join(process.env.LOCALAPPDATA || '', 'Programs')
    for (const dir of ['Nightly Launcher', 'nightly-launcher', 'nightlylauncher']) {
      const p = path.join(base, dir, 'Nightly Launcher.exe')
      try { if (fs.existsSync(p)) return p } catch {}
    }
    return path.join(base, 'Nightly Launcher', 'Nightly Launcher.exe')
  }
  if (process.platform === 'linux') {
    const bin = '/usr/bin/nightly-launcher'
    try { if (fs.existsSync(bin)) return bin } catch {}
    return process.execPath
  }
  return process.execPath
}

function relaunchApp () {
  const target = relaunchExe()
  if (process.platform === 'win32') spawnDetached('cmd.exe', ['/c', 'start', '', '"' + target + '"'])
  else spawnDetached(target, [])
  setTimeout(() => app.quit(), 400)
}

ipcMain.handle('updates:download', async () => {
  const info = await checkUpdates(true)
  const res = await updates.download(info, p => {
    send('update:progress', {
      received: p.received, total: p.total, percent: p.total ? p.received / p.total : 0, dest: p.dest
    })
  })
  const install = updates.installCommand(res.path)
  if (install) {
    send('update:progress', { phase: 'install', label: install.label })
    const code = await runInstall(install)
    if (code === 0) {
      relaunchApp()
      return { ok: true, installed: install.label, relaunching: true }
    }
    shell.openPath(res.path).catch(() => {})
    return { ok: true, installed: null, relaunching: false }
  }
  if (process.platform === 'win32') {
    const script = path.join(paths.cache(), 'nightly-update-' + Date.now() + '.cmd')
    const target = relaunchExe()
    fs.writeFileSync(script, '@echo off\r\ntimeout /t 2 /nobreak >nul\r\nstart "" /wait "' + res.path + '" /S\r\nif exist "' + target + '" start "" "' + target + '"\r\n')
    spawnDetached('cmd.exe', ['/c', script])
    setTimeout(() => app.quit(), 500)
    return { ok: true, installed: null, relaunching: true }
  }
  shell.openPath(res.path).catch(() => {})
  return { ok: true, installed: null, relaunching: false }
})

ipcMain.handle('updates:ignore', (e, version) => config.save({ updateIgnoredVersion: version || '' }))
ipcMain.handle('updates:setEnabled', (e, enabled) => config.save({ checkForUpdates: !!enabled }))
ipcMain.handle('updates:openReleases', () => shell.openExternal('https://github.com/Vase500/nightlylauncher/releases'))

ipcMain.handle('native:detect', () => native.detect())

ipcMain.handle('versions:list', (e, filters) => mojang.listVersions(filters))
ipcMain.handle('loaders:list', (e, loader, mc) => loaders.listLoaderVersions(loader, mc))
ipcMain.handle('loaders:supported', (e, loader) => loaders.supportedMinecraftVersions(loader))

ipcMain.handle('instances:list', () => instances.list())
ipcMain.handle('instances:create', (e, data) => instances.create(data))
ipcMain.handle('instances:update', (e, id, patch) => instances.update(id, patch))
ipcMain.handle('instances:remove', (e, id) => instances.remove(id))
ipcMain.handle('instances:duplicate', (e, id) => instances.dup(id))

ipcMain.handle('instances:chooseIcon', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose an instance icon',
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
      { name: 'All files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (r.canceled || !r.filePaths.length) return null
  const filePath = r.filePaths[0]
  try {
    const extMatch = /\.(png|jpg|jpeg|webp)$/i.exec(filePath)
    const ext = extMatch ? extMatch[0].slice(1).toLowerCase() : 'png'
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
    const buf = fs.readFileSync(filePath)
    return { path: filePath, dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64') }
  } catch {
    return { path: filePath, dataUrl: null }
  }
})

ipcMain.handle('logs:read', (e, instanceId) => {
  const dir = path.join(instances.gameDir(instanceId), 'logs')
  const read = (name) => {
    try {
      const p = path.join(dir, name)
      if (!fs.existsSync(p)) return { exists: false, content: '' }
      return { exists: true, content: fs.readFileSync(p, 'utf8') }
    } catch { return { exists: false, content: '' } }
  }
  return { console: read('nightly.log'), game: read('latest.log') }
})

ipcMain.handle('mods:list', (e, instanceId) => mods.list(instanceId))
const resolveSkipped = new Set()
const LOADER_TOKENS = new Set(['fabric', 'forge', 'fapi', 'quilt', 'neoforge', 'fml', 'client', 'server', 'universal', 'all', 'mod', 'optifine'])
const isVersionish = t => /^\d+$/.test(t) || /^v?\d[\d.]*$/.test(t) || /^mc\d/.test(t) || /^[\d.]+$/.test(t)

function slugCandidates (filename) {
  const stem = String(filename)
    .replace(/\.jar$/i, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .split(/[-_.+ ]+/)
    .filter(t => /^[a-z0-9]+$/.test(t))
  const tokens = stem.slice()
  while (tokens.length && isVersionish(tokens[tokens.length - 1])) tokens.pop()
  while (tokens.length && LOADER_TOKENS.has(tokens[tokens.length - 1])) tokens.pop()
  const out = []
  for (let k = tokens.length; k >= 1; k--) out.push(tokens.slice(0, k).join('-'))
  const seen = new Set()
  return out.filter(s => s && s.length >= 3 && (seen.has(s) ? false : (seen.add(s), true))).slice(0, 4)
}

async function iconDataUrl (url) {
  try {
    const buf = await util.getBuffer(url)
    const mime = /\.([a-z0-9]+)(\?|$)/i.test(url) && /\.webp(\?|$)/i.test(url) ? 'image/webp' : 'image/png'
    return 'data:' + mime + ';base64,' + buf.toString('base64')
  } catch {
    return url
  }
}

ipcMain.handle('mods:resolveIcons', async (e, instanceId) => {
  const modsList = mods.list(instanceId)
  const meta = mods.readMeta(instanceId)
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

  // 0) read metadata + icon straight out of each jar (offline, reliable).
  //    Existing metadata (Modrinth/CurseForge installs) wins for name/slug/
  //    icon; the jar fills in whatever is missing (id, version, icon).
  let changed = false
  {
    const dir = mods.modsDir(instanceId)
    for (const m of modsList) {
      const existing = meta[m.filename]
      if (existing && existing.source === 'jar' && existing.mtime === m.mtime) continue
      try {
        const jm = mods.readJarMeta(path.join(dir, m.filename))
        if (!jm) continue
        const merged = Object.assign({}, jm, existing || {})
        merged.mtime = m.mtime
        merged.source = 'jar'
        meta[m.filename] = merged
        changed = true
      } catch {}
    }
  }

  const pending = modsList.filter(m => {
    if (meta[m.filename] && meta[m.filename].icon) return false
    if (resolveSkipped.has(instanceId + '\u0000' + m.filename)) return false
    return true
  })
  const newMeta = {}

  // 1) one bulk lookup per 50 candidate slugs instead of one search per mod
  const wanted = new Map()
  for (const m of pending) {
    for (const s of slugCandidates(m.filename)) if (!wanted.has(s)) wanted.set(s, null)
  }
  const bySlug = new Map()
  if (wanted.size) {
    const projects = await modrinth.getProjects([...wanted.keys()])
    for (const p of projects) bySlug.set(p.slug, p)
  }
  const needSearch = []
  for (const m of pending) {
    const core = slugCandidates(m.filename)[0] || ''
    const fnNorm = norm(m.filename)
    let best = null
    for (const s of slugCandidates(m.filename)) {
      const p = bySlug.get(s)
      if (!p || !p.icon) continue
      const pn = norm(p.slug)
      if (fnNorm.includes(pn) && (core.startsWith(pn) || pn.startsWith(core))) {
        if (!best || pn.length > norm(best.slug).length) best = p
      }
    }
    if (best) {
      newMeta[m.filename] = { name: best.title, slug: best.slug, icon: best.icon }
    } else {
      needSearch.push(m)
    }
  }

  // 2) parallel search fallback for filenames the bulk lookup missed
  let idx = 0
  const worker = async () => {
    while (idx < needSearch.length) {
      const m = needSearch[idx++]
      const stem = String(m.filename)
        .replace(/\.jar$/i, '')
        .replace(/[-_.](mc|forge|fabric|fapi|quilt|neoforge|1\.1[0-9]|1\.2[0-9])[\w.-]*$/i, '')
        .replace(/[-_.]+/g, ' ')
        .trim()
      if (stem.length < 3) {
        resolveSkipped.add(instanceId + '\u0000' + m.filename)
        continue
      }
      try {
        const hits = await modrinth.search({ query: stem, limit: 3, type: 'mod' })
        const fnNorm = norm(m.filename)
        const hit = hits.find(h => fnNorm.includes(norm(h.slug))) || hits[0]
        if (hit && hit.icon) newMeta[m.filename] = { name: hit.title, slug: hit.slug, icon: hit.icon }
        else resolveSkipped.add(instanceId + '\u0000' + m.filename)
      } catch {
        resolveSkipped.add(instanceId + '\u0000' + m.filename)
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker(), worker()])

  // 3) embed icons as data URLs so every later open is offline-instant (Prism-style local cache)
  const files = Object.keys(newMeta)
  let i2 = 0
  const embed = async () => {
    while (i2 < files.length) {
      const fn = files[i2++]
      const entry = newMeta[fn]
      entry.icon = await iconDataUrl(entry.icon)
      meta[fn] = Object.assign({}, meta[fn], entry)
      changed = true
    }
  }
  await Promise.all([embed(), embed(), embed(), embed(), embed(), embed(), embed(), embed()])
  if (changed) mods.writeMeta(instanceId, meta)
  return modsList.map(m => Object.assign({}, m, { meta: meta[m.filename] || null }))
})
ipcMain.handle('mods:openFolder', async (e, instanceId) => {
  const dir = mods.openFolder(instanceId)
  shell.openPath(dir).catch(() => {})
  return dir
})
ipcMain.handle('mods:chooseJar', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a mod (.jar)',
    filters: [
      { name: 'Minecraft mods', extensions: ['jar'] },
      { name: 'All files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (r.canceled || !r.filePaths.length) return null
  return r.filePaths[0]
})
ipcMain.handle('mods:installCustom', (e, instanceId, srcPath) => mods.installCustom(instanceId, srcPath))
ipcMain.handle('mods:remove', (e, instanceId, filename) => mods.remove(instanceId, filename))
ipcMain.handle('mods:searchModrinth', (e, query, page) => modrinth.search({ query, offset: (page || 0) * 20, type: 'mod' }))
ipcMain.handle('mods:modrinthVersions', (e, instanceId, projectId) => {
  const inst = instances.get(instanceId)
  const gameVersions = inst && inst.mcVersion ? [inst.mcVersion] : []
  const loaders = inst && inst.loader && inst.loader !== 'vanilla' ? [inst.loader] : []
  return modrinth.getVersions(projectId, { gameVersions, loaders })
})
ipcMain.handle('mods:installModrinth', (e, instanceId, projectId, versionId, metaArg, jobId) => {
  return installWrapper(jobId, ({ signal, progress }) => (async () => {
    const vf = await modrinth.versionFile(projectId, versionId)
    const res = await mods.installFromUrl(instanceId, vf.file.url, vf.file.filename, p => progress({
      phase: 'download', received: p.received, total: p.total, percent: p.received / (p.total || 1)
    }), signal)
    if (metaArg && metaArg.slug) mods.setMeta(instanceId, res.filename, { name: metaArg.name, slug: metaArg.slug, icon: metaArg.icon })
    return res
  })())
})
ipcMain.handle('mods:searchCurse', (e, query, page) => curseforge.search({ query, index: (page || 0) * 20, cfg: config.load(), type: 'mc-mods' }))
ipcMain.handle('mods:curseFiles', (e, instanceId, modId) => {
  const inst = instances.get(instanceId)
  return curseforge.getFiles(modId, {
    cfg: config.load(),
    gameVersion: inst && inst.mcVersion ? inst.mcVersion : undefined,
    pageSize: 50
  })
})
ipcMain.handle('mods:installCurse', (e, instanceId, modId, fileId, metaArg, jobId) => {
  return installWrapper(jobId, ({ signal, progress }) => (async () => {
    const dir = mods.modsDir(instanceId)
    fs.mkdirSync(dir, { recursive: true })
    const dl = await curseforge.downloadFile(modId, fileId, dir, { onProgress: (p) => progress(p), signal })
    if (metaArg && metaArg.slug) mods.setMeta(instanceId, dl.filename, { name: metaArg.name, slug: metaArg.slug, icon: metaArg.icon })
    return { filename: dl.filename, size: dl.size }
  })())
})

ipcMain.handle('install:loader', (e, loader, mc, loaderVersion, instanceId) => {
  return loaders.installLoader(loader, mc, loaderVersion, p => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('import:progress', p)
  }).then(res => {
    if (instanceId) instances.update(instanceId, { versionId: res.id })
    return res
  })
})

ipcMain.handle('launch:start', (e, instanceId) => {
  const inst = instances.get(instanceId)
  if (!inst) throw new Error('Instance not found')
  if (launcher.isRunning(instanceId)) throw new Error('Instance already running')
  return launcher.launch(inst, {
    onProgress: sendProgress(instanceId),
    onLog: sendLog(instanceId),
    onExit: sendExit(instanceId)
  }).then(() => {
    instances.update(instanceId, { lastPlayed: Date.now() })
    return { ok: true }
  })
})
ipcMain.handle('launch:stop', (e, instanceId) => {
  launcher.stop(instanceId)
  return true
})
ipcMain.handle('launch:running', (e, instanceId) => launcher.isRunning(instanceId))

ipcMain.handle('packs:detect', (e, file) => importers.detectPackType(file))
ipcMain.handle('packs:recommendedRam', (e, file) => importers.recommendedRam(file))
ipcMain.handle('packs:import', (e, file, opts, jobId) => {
  return installWrapper(jobId, ({ signal, progress }) => {
    return importers.importPack(file, Object.assign({}, opts, { signal, onProgress: (p) => progress(p) }))
  })
})
ipcMain.handle('packs:defaultDownloadDir', () => importers.defaultDownloadDir())

ipcMain.handle('packs:choose', async () => {
  const def = importers.defaultDownloadDir()
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Import modpack',
    defaultPath: def,
    filters: [
      { name: 'Modpacks', extensions: ['mrpack', 'zip'] },
      { name: 'All files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (r.canceled || !r.filePaths.length) return null
  return r.filePaths[0]
})

ipcMain.handle('modrinth:search', (e, query, page) => modrinth.search({ query, offset: (page || 0) * 20 }))
ipcMain.handle('modrinth:get', (e, id) => modrinth.getProject(id))
ipcMain.handle('modrinth:versions', (e, id) => modrinth.getVersions(id))
ipcMain.handle('modrinth:import', (e, id, versionId, opts, jobId) => {
  return installWrapper(jobId, ({ signal, progress }) => (async () => {
    const cfg = config.load()
    const dest = path.join(cfg.downloadsLocation, `${util.sanitize(id)}-${versionId}.mrpack`)
    await modrinth.downloadPack(id, versionId, dest, (p) => progress(p), signal)
    return importers.importPack(dest, Object.assign({}, opts, { signal, onProgress: (p) => progress(p) }))
  })())
})

ipcMain.handle('curse:search', (e, query, page) => curseforge.search({ query, index: (page || 0) * 20, cfg: config.load() }))
ipcMain.handle('curse:mod', (e, id) => curseforge.getMod(id, config.load()))
ipcMain.handle('curse:files', (e, id, opts) => curseforge.getFiles(id, Object.assign({ cfg: config.load() }, opts)))
ipcMain.handle('curse:import', (e, modId, fileId, opts, jobId) => {
  return installWrapper(jobId, ({ signal, progress }) => (async () => {
    const tmp = path.join(paths.cache(), 'curse-' + Date.now())
    const dl = await curseforge.downloadFile(modId, fileId, tmp, { onProgress: (p) => progress(p), signal })
    try {
      return await importers.importPack(dl.path, Object.assign({}, opts, { signal, onProgress: (p) => progress(p) }))
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })())
})

ipcMain.handle('java:detect', () => java.detectJava())
ipcMain.handle('java:listProviderVersions', (e, provider) => java.listProviderVersions(provider))
ipcMain.handle('java:downloadProvider', (e, provider, value) => java.downloadProvider(provider, value, p => send('import:progress', p)))

ipcMain.handle('accounts:list', () => accounts.list().map(a => accounts.publicView(a)))
ipcMain.handle('accounts:selected', () => accounts.publicView(accounts.selected()))
ipcMain.handle('accounts:setSelected', (e, id) => accounts.setSelected(id))
ipcMain.handle('accounts:addOffline', (e, username) => accounts.publicView(accounts.addOffline(username)))
ipcMain.handle('accounts:remove', (e, id) => accounts.remove(id))

ipcMain.handle('skins:profile', (e, accountId) => skins.profile(accountId))
  ipcMain.handle('skins:byUsername', (e, username) => skins.byUsername(username))
  ipcMain.handle('skins:upload', (e, accountId, filePath, variant) => skins.uploadSkin(accountId, filePath, variant))
  ipcMain.handle('skins:uploadData', (e, accountId, dataUrl, variant) => skins.uploadSkinData(accountId, dataUrl, variant))
  ipcMain.handle('skins:remove', (e, accountId, skinId) => skins.removeSkin(accountId, skinId))

  ipcMain.handle('skins:setCape', (e, accountId, capeId) => skins.setActiveCape(accountId, capeId))

ipcMain.handle('skins:choose', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a skin image',
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] },
      { name: 'All files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (r.canceled || !r.filePaths.length) return null
  const filePath = r.filePaths[0]
  try {
    const extMatch = /\.(png|jpg|jpeg|gif)$/i.exec(filePath)
    const ext = extMatch ? extMatch[0].slice(1).toLowerCase() : 'png'
    const mime = ext === 'gif' ? 'image/gif' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
    const buf = fs.readFileSync(filePath)
    return { path: filePath, preview: 'data:' + mime + ';base64,' + buf.toString('base64') }
  } catch {
    return { path: filePath, preview: null }
  }
})

ipcMain.handle('auth:deviceCode', () => auth.requestDeviceCode())
ipcMain.handle('auth:poll', async (e, deviceCode) => {
  try {
    const data = await auth.pollToken(deviceCode)
    return { ok: true, account: accounts.publicView(accounts.addMicrosoft(data)) }
  } catch (err) {
    const code = err.code || ''
    if (code === 'authorization_pending' || code === 'slow_down' || code === 'expired_token' || code === 'access_denied' || code === 'authorization_declined') {
      return { ok: false, code }
    }
    throw new Error(err.message)
  }
})

ipcMain.handle('open:external', (e, url) => shell.openExternal(url))

/* ---------------- window controls (frameless) ---------------- */

ipcMain.handle('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize()
})
ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.handle('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
})

/* ---------------- lifecycle ---------------- */

app.whenReady().then(() => {
  paths.init()
  createSplash()
  createMain()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMain()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
