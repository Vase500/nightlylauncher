'use strict'
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const zlib = require('zlib')
const paths = require('../core/paths')
const config = require('../core/config')
const instances = require('../core/instances')
const mojang = require('../core/mojang')
const loaders = require('../core/loaders')
const java = require('../core/java')
const accounts = require('../core/accounts')
const mods = require('../core/mods')

const probeRoot = path.join(os.tmpdir(), 'nightly-probe-root')

function wipe (dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

// minimal PNG encoder for the probe skin
function crc32 (buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      table[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF]
  return (crc ^ -1) >>> 0
}

function pngChunk (type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td), 0)
  return Buffer.concat([len, td, crc])
}

function pngEncode (width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0
    for (let x = 0; x < width; x++) {
      const o = y * (1 + width * 4) + 1 + x * 4
      const s = (y * width + x) * 4
      raw[o] = rgba[s]
      raw[o + 1] = rgba[s + 1]
      raw[o + 2] = rgba[s + 2]
      raw[o + 3] = rgba[s + 3]
    }
  }
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))])
}

// checkerboard 64x64 skin: distinct color per face region + asymmetric splits to detect mirroring.
// hat layer is transparent.
function skin64 () {
  const W = 64
  const H = 64
  const rgba = new Uint8Array(W * H * 4)
  const fill = (x, y, w, h, c, a) => {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const o = (yy * W + xx) * 4
        rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = a === undefined ? 255 : a
      }
    }
  }
  const A = (r, g, b) => [r, g, b]
  fill(8, 0, 4, 4, A(120, 200, 240))    // head top back-left (u0-4, v0-4)
  fill(12, 0, 4, 4, A(40, 160, 220))    // head top back-right (u4-8, v0-4)
  fill(8, 4, 4, 4, A(0, 255, 255))      // head top front-left (u0-4, v4-8)
  fill(12, 4, 4, 4, A(255, 255, 255))   // head top front-right (u4-8, v4-8)
  fill(16, 0, 8, 8, A(90, 90, 90))      // head bottom
  fill(0, 8, 8, 8, A(0, 255, 0))        // head left green
  fill(8, 8, 4, 8, A(255, 0, 0))        // head front LEFT half red
  fill(12, 8, 4, 8, A(255, 255, 255))   // head front RIGHT half white
  fill(16, 8, 8, 8, A(255, 255, 0))     // head right yellow
  fill(24, 8, 8, 8, A(0, 0, 255))       // head back blue
  fill(40, 0, 8, 8, A(0, 200, 255), 0)  // hat transparent
  fill(48, 0, 8, 8, A(90, 90, 90), 0)
  fill(32, 8, 8, 8, A(0, 255, 0), 0)
  fill(40, 8, 8, 8, A(255, 0, 0), 0)
  fill(48, 8, 8, 8, A(255, 255, 0), 0)
  fill(56, 8, 8, 8, A(0, 0, 255), 0)
  fill(20, 16, 8, 4, A(200, 0, 200))    // torso top
  fill(28, 16, 8, 4, A(80, 80, 80))
  fill(16, 20, 4, 12, A(0, 255, 0))     // torso left green
  fill(20, 20, 4, 12, A(255, 0, 200))   // torso front LEFT half pink
  fill(24, 20, 4, 12, A(0, 255, 0))     // torso front RIGHT half lime
  fill(28, 20, 4, 12, A(255, 255, 0))   // torso right yellow
  fill(32, 20, 8, 12, A(0, 0, 255))     // torso back blue
  fill(44, 16, 4, 4, A(200, 0, 200))
  fill(48, 16, 4, 4, A(80, 80, 80))
  fill(40, 20, 4, 12, A(0, 255, 0))
  fill(44, 20, 4, 12, A(255, 0, 200))
  fill(48, 20, 4, 12, A(255, 255, 0))
  fill(52, 20, 4, 12, A(0, 0, 255))
  fill(4, 16, 4, 4, A(200, 0, 200))
  fill(8, 16, 4, 4, A(80, 80, 80))
  fill(0, 20, 4, 12, A(0, 255, 0))
  fill(4, 20, 4, 12, A(255, 0, 200))
  fill(8, 20, 4, 12, A(255, 255, 0))
  fill(12, 20, 4, 12, A(0, 0, 255))
  return pngEncode(W, H, rgba)
}

const probeSkinDataUrl = 'data:image/png;base64,' + skin64().toString('base64')

// 64x32 cape texture: right half = outside (seen on the player's back), left half = inside.
function cape64 (out, inn) {
  const W = 64
  const H = 32
  const rgba = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    const o = i * 4
    const c = i % W >= 32 ? out : inn
    rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255
  }
  return pngEncode(W, H, rgba)
}
const probeCape1Url = 'data:image/png;base64,' + cape64([255, 0, 0], [150, 0, 0]).toString('base64')
const probeCape2Url = 'data:image/png;base64,' + cape64([255, 255, 0], [150, 150, 0]).toString('base64')

app.whenReady().then(() => {
  wipe(probeRoot)
  paths.init(probeRoot)
  config.save({ javaPath: 'C:/Some/Very/Long/JDK/path/to/java/jdk-21/jdk-21.0.12+8/bin/java.exe' })

  ipcMain.handle('config:get', () => config.load())
  ipcMain.handle('config:set', (e, patch) => config.save(patch))
  ipcMain.handle('instances:list', () => instances.list())
  ipcMain.handle('instances:create', (e, d) => instances.create(d))
  ipcMain.handle('instances:update', (e, id, patch) => instances.update(id, patch))
  ipcMain.handle('instances:remove', (e, id) => instances.remove(id))
  ipcMain.handle('instances:duplicate', (e, id) => instances.dup(id))
  ipcMain.handle('instances:chooseIcon', () => ({ path: 'C:/fake/icon.png', dataUrl: 'data:image/png;base64,AAAA' }))
  ipcMain.handle('logs:read', (e, instanceId) => {
    const dir = path.join(paths.instanceDir(instanceId), 'logs')
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
  ipcMain.handle('mods:resolveIcons', (e, instanceId) => {
    const meta = mods.readMeta(instanceId)
    if (!meta['iris-fabric-mc1.19.2-1.6.1.jar']) {
      meta['iris-fabric-mc1.19.2-1.6.1.jar'] = { name: 'Iris Shaders', slug: 'iris', icon: 'data:image/png;base64,CCCC' }
      mods.writeMeta(instanceId, meta)
    }
    return mods.list(instanceId)
  })
  ipcMain.handle('mods:openFolder', (e, instanceId) => mods.openFolder(instanceId))
  ipcMain.handle('mods:chooseJar', () => path.join(probeRoot, 'fake-mod.jar'))
  ipcMain.handle('mods:installCustom', (e, instanceId, src) => mods.installCustom(instanceId, src))
  ipcMain.handle('mods:remove', (e, instanceId, fn) => mods.remove(instanceId, fn))
  ipcMain.handle('mods:searchModrinth', (e, query, page) => {
    const p = page || 0
    const q = String(query || '').toLowerCase()
    if (q.includes('iris')) return [{ id: 'probe-iris', slug: 'iris', name: 'Iris Shaders', author: 'coderbot', downloads: 5000000, mc: '1.19.2', icon: 'data:image/png;base64,CCCC' }]
    if (p === 0) return [{ id: 'probe-modrinth', slug: 'probe-modrinth', name: 'Probe Modrinth Mod', author: 'ProbeDev', downloads: 1234567, mc: '1.8.9', icon: 'data:image/png;base64,AAAA' }]
    if (p === 1) return [{ id: 'probe-modrinth-2', slug: 'probe-modrinth-2', name: 'Probe Modrinth Mod 2', author: 'ProbeDev', downloads: 999, mc: '1.8.9', icon: 'data:image/png;base64,AAAA' }]
    return []
  })
  ipcMain.handle('mods:modrinthVersions', (e, instanceId, pid) => [
    { id: 'v1', name: '1.0.0', version_number: '1.0.0', game_versions: ['1.8.9'], downloads: 1024 }
  ])
  const installJobs = new Map()
  ipcMain.handle('mods:installModrinth', async (e, instanceId, pid, vid, metaArg, jobId) => {
    const controller = new AbortController()
    if (jobId) installJobs.set(jobId, controller)
    const dir = mods.modsDir(instanceId)
    fs.mkdirSync(dir, { recursive: true })
    const name = 'probe-modrinth-mod-1.0.0.jar'
    const dest = path.join(dir, name)
    fs.writeFileSync(dest + '.part', 'partial')
    const cancelled = () => {
      const err = new Error('Install cancelled')
      err.cancelled = true
      return err
    }
    try {
      for (let i = 0; i < 8; i++) {
        if (controller.signal.aborted) throw cancelled()
        await new Promise(r => setTimeout(r, 60))
      }
      if (controller.signal.aborted) throw cancelled()
      fs.renameSync(dest + '.part', dest)
      if (metaArg && metaArg.slug) mods.setMeta(instanceId, name, { name: metaArg.name, slug: metaArg.slug, icon: metaArg.icon })
      return { filename: name, size: 4 }
    } catch (e) {
      try { fs.rmSync(dest + '.part', { force: true }) } catch {}
      throw e
    } finally {
      if (jobId) installJobs.delete(jobId)
    }
  })
  ipcMain.handle('install:cancel', (e, jobId) => {
    const c = installJobs.get(jobId)
    if (!c) return false
    c.abort()
    return true
  })
  ipcMain.handle('mods:searchCurse', (e, query, page) => {
    const p = page || 0
    if (p === 0) return [{ id: 'probe-curse', slug: 'probe-curse', name: 'Probe Curse Mod', author: 'CurseDev', downloads: 999, mc: '1.8.9', icon: 'data:image/png;base64,BBBB' }]
    if (p === 1) return [{ id: 'probe-curse-2', slug: 'probe-curse-2', name: 'Probe Curse Mod 2', author: 'CurseDev', downloads: 123, mc: '1.8.9', icon: 'data:image/png;base64,BBBB' }]
    return []
  })
  ipcMain.handle('mods:curseFiles', (e, instanceId, mid) => [
    { id: 555, name: '1.0.0', displayName: '1.0.0', fileName: 'probe-curse-mod-1.0.0.jar', fileLength: 2048, gameVersions: ['1.8.9'] }
  ])
  ipcMain.handle('mods:installCurse', (e, instanceId, mid, fid, metaArg) => {
    const dir = mods.modsDir(instanceId)
    fs.mkdirSync(dir, { recursive: true })
    const name = 'probe-curse-mod-1.0.0.jar'
    fs.writeFileSync(path.join(dir, name), 'fake')
    if (metaArg && metaArg.slug) mods.setMeta(instanceId, name, { name: metaArg.name, slug: metaArg.slug, icon: metaArg.icon })
    return { filename: name, size: 4 }
  })
  ipcMain.handle('launch:running', () => false)
  ipcMain.handle('versions:list', (e, filters) => mojang.listVersions(filters))
  ipcMain.handle('loaders:list', (e, loader, mc) => loaders.listLoaderVersions(loader, mc))
  ipcMain.handle('loaders:supported', (e, loader) => loaders.supportedMinecraftVersions(loader))
  ipcMain.handle('java:detect', () => java.detectJava())
  ipcMain.handle('java:listProviderVersions', (e, provider) => {
    if (provider === 'adoptium') return [{ value: '21', major: 21, label: 'Java 21 (LTS)' }, { value: '17', major: 17, label: 'Java 17 (LTS)' }]
    if (provider === 'oracle') return [{ value: '21', major: 21, label: 'Java 21' }, { value: '25', major: 25, label: 'Java 25' }]
    return [
      { value: 'jre-legacy', component: 'jre-legacy', major: 8, label: 'Java 8 · jre-legacy (8u51-cacert462b08)' },
      { value: 'java-runtime-delta', component: 'java-runtime-delta', major: 21, label: 'Java 21 · java-runtime-delta (21.0.7)' }
    ]
  })
  ipcMain.handle('java:downloadProvider', (e, provider, value) => {
    const fake = path.join(paths.root(), 'probe-java-' + provider + '-' + value + (process.platform === 'win32' ? '.exe' : ''))
    fs.writeFileSync(fake, '')
    return fake
  })
  ipcMain.handle('modrinth:search', () => ({ hits: [], offset: 0, limit: 20, total_hits: 0 }))
  ipcMain.handle('accounts:list', () => accounts.list().map(a => accounts.publicView(a)))
  ipcMain.handle('accounts:selected', () => accounts.publicView(accounts.selected()))
  ipcMain.handle('accounts:setSelected', (e, id) => accounts.setSelected(id))
  ipcMain.handle('accounts:addOffline', (e, u) => accounts.publicView(accounts.addOffline(u)))
  ipcMain.handle('accounts:remove', (e, id) => accounts.remove(id))
  ipcMain.handle('auth:deviceCode', () => ({ deviceCode: 'probe', userCode: 'PROBE', verificationUri: 'https://login.microsoftonline.com', interval: 5, expiresIn: 900, message: '' }))
  ipcMain.handle('auth:poll', () => ({ ok: false, code: 'authorization_pending' }))
  ipcMain.handle('open:external', () => {})
  const mockProfile = {
    id: '0'.repeat(32), name: 'MsProbe',
    skins: [{ id: 'skin-1', state: 'ACTIVE', url: probeSkinDataUrl, variant: 'CLASSIC' }],
    capes: [
      { id: 'cape-1', state: 'ACTIVE', url: probeCape1Url, alias: 'Minecon 2012' },
      { id: 'cape-2', state: 'INACTIVE', url: probeCape2Url, alias: 'Mojang' }
    ]
  }
  ipcMain.handle('skins:profile', () => JSON.parse(JSON.stringify(mockProfile)))
  ipcMain.handle('skins:byUsername', (e, username) => {
    if (username === 'SkinUser') return { skin: probeSkinDataUrl, cape: probeCape1Url, slim: false }
    return null
  })
  ipcMain.handle('skins:upload', () => ({ id: '0'.repeat(32), name: 'MsProbe', skins: [{ id: 'skin-2', state: 'ACTIVE', url: probeSkinDataUrl, variant: 'CLASSIC' }], capes: [] }))
  ipcMain.handle('skins:remove', () => ({ id: '0'.repeat(32), name: 'MsProbe', skins: [], capes: [] }))
  ipcMain.handle('skins:setCape', (e, accountId, capeId) => {
    mockProfile.capes = mockProfile.capes.map(c => Object.assign({}, c, { state: c.id === capeId ? 'ACTIVE' : 'INACTIVE' }))
    return JSON.parse(JSON.stringify(mockProfile))
  })
  ipcMain.handle('skins:choose', () => ({ path: 'C:/fake/skin.png', preview: probeSkinDataUrl }))

  const win = new BrowserWindow({
    width: 1000, height: 700, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const errors = []
  win.webContents.on('console-message', (e, level, message, line, sourceId) => {
    if (level >= 2) errors.push(level + ': ' + message + ' (' + sourceId + ' ' + line + ')')
  })

  const js = (code) => win.webContents.executeJavaScript(code)
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))

  win.webContents.on('did-finish-load', async () => {
    try {
      await sleep(2500)

      // ---- onboarding wizard ----
      const w1 = await js(`(() => {
        const wiz = document.querySelector('.wizard-root')
        const hasContinue = wiz && !![...wiz.querySelectorAll('button')].find(b => b.textContent === 'Continue')
        return { wizardVisible: !!wiz, hasContinue }
      })()`)
      console.log('wizard welcome:', JSON.stringify(w1))

      await js(`[...document.querySelectorAll('.wizard-root button')].find(b => b.textContent === 'Continue').click()`)
      await sleep(400)
      const w2 = await js(`(() => ({
        options: document.querySelectorAll('.account-option').length,
        setuLater: !![...document.querySelectorAll('.wizard-root button')].find(b => b.textContent.includes('Set up later'))
      }))()`)
      console.log('wizard account step:', JSON.stringify(w2))

      await js(`document.querySelectorAll('.account-option')[1].click()`)
      await sleep(400)
      await js(`(() => { const i = document.querySelector('#modal-root input'); i.value = 'ProbeUser'; const b = [...document.querySelectorAll('#modal-root .modal-actions button')].find(x => x.textContent === 'Continue'); b.click() })()`)
      await sleep(400)
      const w3 = await js(`(() => ({
        done: !!document.querySelector('.wizard-icon.ok'),
        cta: !![...document.querySelectorAll('.wizard-root button')].find(b => b.textContent.includes('Continue to Launcher'))
      }))()`)
      console.log('wizard done step:', JSON.stringify(w3))

      await js(`[...document.querySelectorAll('.wizard-root button')].find(b => b.textContent.includes('Continue to Launcher')).click()`)
      await sleep(400)
      const w4 = await js(`(() => ({
        wizardGone: !document.querySelector('.wizard-root'),
        chip: (document.querySelector('.user-chip-name') || {}).textContent || null
      }))()`)
      console.log('wizard finished:', JSON.stringify(w4))

      // ---- user chip dropdown ----
      await js(`document.querySelector('.user-chip-btn').click()`)
      await sleep(200)
      const w5 = await js(`(() => ({
        menuOpen: document.querySelector('.user-chip-wrap').classList.contains('open'),
        items: [...document.querySelectorAll('.user-chip-item')].map(i => i.textContent).filter(t => t)
      }))()`)
      console.log('user chip menu:', JSON.stringify(w5))
      await js(`document.body.click()`)

      // ---- create instance modal + filters (existing regression) ----
      await js(`document.getElementById('btn-new').click()`)
      await sleep(2500)
      const r2 = await js(`(() => {
        const mc = document.querySelector('#modal-root .modal')
        const opts = [...mc.querySelectorAll('select')]
        return { selects: opts.length, hasFilters: !!document.querySelector('.filter-chips') }
      })()`)
      console.log('create modal:', JSON.stringify(r2))

      const diag = await js(`(async () => {
        try {
          const sup = await api.loaders.supported('forge')
          const ver = await api.versions.list({ releases: true, snapshots: true, betas: true, alphas: true, experiments: true })
          return { supLen: sup ? sup.length : null, verCount: ver ? ver.length : null }
        } catch (e) { return { err: e.message } }
      })()`)
      console.log('renderer supported+versions diag:', JSON.stringify(diag))

      await js(`(() => {
        const sels = [...document.querySelectorAll('#modal-root .modal select')]
        sels[0].value = 'forge'; sels[0].dispatchEvent(new Event('change'))
      })()`)
      await sleep(3000)
      const r3 = await js(`(async () => {
        const sels = [...document.querySelectorAll('#modal-root .modal select')]
        const mcOpts = [...sels[1].options].map(o => o.value)
        const hasBeta = mcOpts.some(v => v.includes('beta') || v.includes('snapshot'))
        const has189 = mcOpts.includes('1.8.9')
        return { mcCount: mcOpts.length, hasBeta, has189, sample: mcOpts.slice(0, 5) }
      })()`)
      console.log('forge mc filter:', JSON.stringify(r3))

      await js(`(() => {
        const sels = [...document.querySelectorAll('#modal-root .modal select')]
        sels[0].value = 'neoforge'; sels[0].dispatchEvent(new Event('change'))
      })()`)
      await sleep(3000)
      const r4 = await js(`(() => {
        const sels = [...document.querySelectorAll('#modal-root .modal select')]
        const opts = [...sels[1].options].map(o => o.value)
        const none = opts.length === 1 && opts[0] === ''
        return { noneLabel: none ? sels[1].options[0].text : null }
      })()`)
      console.log('neoforge no-versions state:', JSON.stringify(r4))

      await js(`(() => {
        const sels = [...document.querySelectorAll('#modal-root .modal select')]
        sels[0].value = 'vanilla'; sels[0].dispatchEvent(new Event('change'))
      })()`)
      await sleep(2000)
      const r5a = await js(`(() => {
        const sels = [...document.querySelectorAll('#modal-root .modal select')]
        return { vanillaReleases: sels[1].options.length }
      })()`)
      await js(`(() => {
        const chips = [...document.querySelectorAll('.filter-chip')]
        const snap = chips.find(c => c.textContent.includes('Snapshots'))
        snap.querySelector('input').click()
      })()`)
      await sleep(2000)
      const r5b = await js(`(() => {
        const sels = [...document.querySelectorAll('#modal-root .modal select')]
        return { vanillaWithSnapshots: sels[1].options.length }
      })()`)
      console.log('filter toggle:', JSON.stringify({ releasesOnly: r5a.vanillaReleases, withSnapshots: r5b.vanillaWithSnapshots }))

      // with snapshots now on, switch to NeoForge and uncheck Releases -> no versions label
      await js(`(() => {
        const sels = [...document.querySelectorAll('#modal-root .modal select')]
        sels[0].value = 'neoforge'; sels[0].dispatchEvent(new Event('change'))
      })()`)
      await sleep(2500)
      await js(`(() => {
        const chips = [...document.querySelectorAll('.filter-chip')]
        const rel = chips.find(c => c.textContent.includes('Releases'))
        rel.querySelector('input').click()
      })()`)
      await sleep(2000)
      const r5c = await js(`(() => {
        const sels = [...document.querySelectorAll('#modal-root .modal select')]
        const opts = [...sels[1].options]
        return { count: opts.length, emptyText: opts.length === 1 && opts[0].value === '' ? opts[0].text : null }
      })()`)
      console.log('no-versions label:', JSON.stringify(r5c))

      // ---- fabric 1.20.1 must list many loader builds (stable-only collapse regression) ----
      await js(`(() => {
        const chips = [...document.querySelectorAll('.filter-chip')]
        const set = (label, on) => {
          const c = chips.find(x => x.textContent.includes(label))
          const i = c && c.querySelector('input')
          if (i && i.checked !== on) i.click()
        }
        set('Releases', true)
        set('Snapshots', false)
      })()`)
      await sleep(1500)
      await js(`(() => {
        const sels = [...document.querySelectorAll('#modal-root .modal select')]
        sels[0].value = 'fabric'; sels[0].dispatchEvent(new Event('change'))
      })()`)
      await sleep(3500)
      await js(`(() => {
        const sels = [...document.querySelectorAll('#modal-root .modal select')]
        sels[1].value = '1.20.1'; sels[1].dispatchEvent(new Event('change'))
      })()`)
      await sleep(3500)
      const fab = await js(`(() => {
        const sels = [...document.querySelectorAll('#modal-root .modal select')]
        const opts = [...sels[2].options].map(o => o.value)
        const status = sels[2].parentElement.querySelector('.hint')
        return { count: opts.length, sample: opts.slice(0, 3), status: status ? status.textContent : null }
      })()`)
      console.log('fabric loader versions 1.20.1:', JSON.stringify(fab))

      // ---- new-instance memory toggle uses global memory by default ----
      const memTest = await js(`(() => {
        const rows = [...document.querySelectorAll('#modal-root .modal .form-field')]
        const row = rows.find(f => f.textContent.includes('Use global memory'))
        const cb = row && row.querySelector('input')
        const nums = [...document.querySelectorAll('#modal-root .modal input[type=number]')]
        return { hasToggle: !!row, checked: cb ? cb.checked : null, maxMemDisabled: nums[0] ? nums[0].disabled : null }
      })()`)
      console.log('create modal memory toggle:', JSON.stringify(memTest))

      await js(`document.querySelector('#modal-root .modal .close').click()`)
      await sleep(300)

      // ---- settings account card ----
      await js(`document.querySelector('[data-view="settings"]').click()`)
      await sleep(800)
      const s1 = await js(`(() => {
        const rows = [...document.querySelectorAll('.account-row')]
        const actions = [...document.querySelectorAll('.account-actions button')].map(b => b.textContent)
        return { rows: rows.map(r => r.textContent), selected: rows.filter(r => r.classList.contains('selected')).length, actions }
      })()`)
      console.log('settings account card:', JSON.stringify(s1))

      // ---- microsoft sign-in modal keeps polling (no "Sign in failed") ----
      await js(`[...document.querySelectorAll('.account-actions button')].find(b => b.textContent === 'Add Microsoft').click()`)
      await sleep(2000)
      const m1 = await js(`(() => {
        const code = (document.querySelector('.auth-code') || {}).textContent || ''
        const status = (document.querySelector('.auth-row + .hint') || {}).textContent || ''
        return { codeShown: code !== '…', status, waiting: status.includes('Waiting'), failed: status.includes('Sign in failed') }
      })()`)
      console.log('microsoft modal polling:', JSON.stringify(m1))
      await js(`[...document.querySelectorAll('#modal-root .modal-actions button')].find(b => b.textContent === 'Cancel').click()`)
      await sleep(300)

      // ---- download java modal (provider + version dropdowns) ----
      await js(`[...document.querySelectorAll('#settings-form button')].find(b => b.textContent === 'Download Java').click()`)
      await sleep(600)
      const j1 = await js(`(() => {
        const modal = document.querySelector('#modal-root .modal')
        const sels = [...modal.querySelectorAll('select')]
        return {
          providers: [...sels[0].options].map(o => o.text),
          versionOptions: [...sels[1].options].map(o => o.text)
        }
      })()`)
      console.log('download java modal:', JSON.stringify(j1))
      await js(`(() => {
        const modal = document.querySelector('#modal-root .modal')
        const sels = [...modal.querySelectorAll('select')]
        sels[0].value = 'oracle'; sels[0].dispatchEvent(new Event('change'))
      })()`)
      await sleep(400)
      const j2 = await js(`(() => {
        const modal = document.querySelector('#modal-root .modal')
        const sels = [...modal.querySelectorAll('select')]
        return { oracleVersions: [...sels[1].options].map(o => o.text) }
      })()`)
      console.log('download java oracle versions:', JSON.stringify(j2))
      await js(`(() => {
        const modal = document.querySelector('#modal-root .modal')
        const sels = [...modal.querySelectorAll('select')]
        sels[0].value = 'mojang'; sels[0].dispatchEvent(new Event('change'))
      })()`)
      await sleep(400)
      const j3 = await js(`(() => {
        const modal = document.querySelector('#modal-root .modal')
        const sels = [...modal.querySelectorAll('select')]
        return { mojangVersions: [...sels[1].options].map(o => o.text) }
      })()`)
      console.log('download java mojang versions:', JSON.stringify(j3))
      await js(`[...document.querySelectorAll('#modal-root .modal-actions button')].find(b => b.textContent === 'Cancel').click()`)
      await sleep(300)

      // ---- settings java select: short labels + full-path hint ----
      await js(`[...document.querySelectorAll('#settings-form button')].find(b => b.textContent === 'Detect').click()`)
      await sleep(600)
      const j4 = await js(`(() => {
        const sel = [...document.querySelectorAll('#settings-form select')].find(s => [...s.options].some(o => o.text.startsWith('Java ') || o.text === 'No Java found'))
        const opts = sel ? [...sel.options].map(o => o.text) : []
        const hint = document.querySelector('.path-hint')
        return {
          optionCount: opts.length,
          opts,
          hasConfiguredShort: opts.some(t => t.startsWith('Java (configured)') && !t.includes('Some/Very/Long')),
          configuredIsFull: opts.some(t => t.includes('Some/Very/Long')),
          hintText: hint ? hint.textContent : null,
          hintClass: hint ? hint.className : null
        }
      })()`)
      console.log('settings java labels:', JSON.stringify(j4))

      // ---- theme switch ----
      await js(`(() => {
        const sel = [...document.querySelectorAll('#settings-form select')].find(s => [...s.options].some(o => o.text === 'Midnight'))
        sel.value = 'light'; sel.dispatchEvent(new Event('change'))
      })()`)
      await sleep(300)
      const r6 = await js(`(() => document.documentElement.dataset.theme)()`)
      console.log('theme after switch:', r6)
      await js(`(() => {
        const sel = [...document.querySelectorAll('#settings-form select')].find(s => [...s.options].some(o => o.text === 'Midnight'))
        sel.value = 'midnight'; sel.dispatchEvent(new Event('change'))
      })()`)

      // ---- launch guard (no account) ----
      await js(`(async () => {
        const accs = await api.accounts.list()
        for (const a of accs) await api.accounts.remove(a.id)
        await api.instances.create({ name: 'ProbeInst', loader: 'vanilla', mcVersion: '1.8.9', loaderVersion: '', maxMemory: 4096, minMemory: 512, jvmArgs: '', resolution: { width: 854, height: 480 }, javaPath: '' })
      })()`)
      await sleep(400)
      await js(`document.querySelector('[data-view="instances"]').click()`)
      await sleep(800)
      await js(`document.querySelector('#instance-grid .card .btn.primary').click()`)
      await sleep(400)
      const g1 = await js(`(() => {
        const modal = document.querySelector('#modal-root .modal')
        const hasText = modal && modal.textContent.includes('To continue at least one account has to be present')
        const setu = modal && [...modal.querySelectorAll('button')].find(b => b.textContent === 'Set up')
        return { guardShown: hasText, hasSetUp: !!setu }
      })()`)
      console.log('launch guard:', JSON.stringify(g1))
      await js(`[...document.querySelectorAll('#modal-root .modal button')].find(b => b.textContent === 'Set up').click()`)
      await sleep(400)
      const g2 = await js(`(() => ({
        onSettings: document.querySelector('#view-settings').classList.contains('active')
      }))()`)
      console.log('guard -> settings:', JSON.stringify(g2))

      // re-add an account via settings and verify selection
      await js(`[...document.querySelectorAll('.account-actions button')].find(b => b.textContent === 'Add Offline').click()`)
      await sleep(400)
      await js(`(() => { const i = document.querySelector('#modal-root input'); i.value = 'ReAddUser'; const b = [...document.querySelectorAll('#modal-root .modal-actions button')].find(x => x.textContent === 'Continue'); b.click() })()`)
      await sleep(400)
      const s2 = await js(`(async () => {
        const rows = [...document.querySelectorAll('.account-row')]
        const sel = await api.accounts.selected()
        return { rows: rows.map(r => r.querySelector('.account-row-name').textContent), selectedId: sel ? sel.id : null, selectedRow: rows.filter(r => r.classList.contains('selected')).length }
      })()`)
      console.log('account re-add:', JSON.stringify(s2))

      // ---- skin & cape modal for a microsoft account ----
      accounts.addMicrosoft({ username: 'MsProbe', uuid: '0'.repeat(32), xuid: '12345', accessToken: 'fake', refreshToken: 'fake', expiresAt: Date.now() + 3600e3 })
      await sleep(200)
      await js(`document.querySelector('[data-view="instances"]').click()`)
      await sleep(300)
      await js(`document.querySelector('[data-view="settings"]').click()`)
      await sleep(600)
      await js(`(() => {
        const row = [...document.querySelectorAll('.account-row')].find(r => r.textContent.includes('MsProbe'))
        ;[...row.querySelectorAll('button')].find(b => b.textContent === 'Skin & Cape').click()
      })()`)
      await sleep(800)
      const s3 = await js(`(() => {
        const modal = document.querySelector('#modal-root .modal')
        return {
          title: modal ? modal.querySelector('h3').textContent : null,
          hasSkin: !!modal && !!modal.querySelector('.skin-3d-canvas'),
          skinBadge: modal ? ((modal.querySelector('.skin-label .badge') || {}).textContent || null) : null,
          hasCape: !!modal && !!modal.querySelector('.cape-preview'),
          actions: modal ? [...modal.querySelectorAll('.skin-actions button')].map(b => b.textContent) : []
        }
      })()`)
      console.log('skin modal:', JSON.stringify(s3))
      const shot = await js(`(() => {
        const cv = document.querySelector('#modal-root .modal .skin-3d-canvas')
        return cv ? cv.toDataURL('image/png') : null
      })()`)
      if (shot) {
        fs.writeFileSync(path.join(probeRoot, 'skin-preview.png'), Buffer.from(shot.split(',')[1], 'base64'))
        console.log('skin preview saved')
      }
        const px = await js(`(() => {
        const cv = document.querySelector('#modal-root .modal .skin-3d-canvas')
        const v = cv && cv.__viewer
        if (!v || !v.renderer) return { err: 'viewer not ready' }
        const read = () => {
          v.renderer.render(v.scene, v.camera)
          const gl = v.renderer.getContext()
          const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
          const buf = new Uint8Array(w * h * 4)
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
          let nz = 0
          for (let i = 3; i < buf.length; i += 4) if (buf[i] > 0) nz++
          return nz
        }
        const r = {}
        r.frontPixels = read()
        v.playerObject.rotation.y = Math.PI
        r.backPixels = read()
        v.playerObject.rotation.y = 0
        return r
      })()`)
      console.log('skin 3d pixels:', JSON.stringify(px))
      const c3 = await js(`(() => {
        const modal = document.querySelector('#modal-root .modal')
        const cells = [...modal.querySelectorAll('.cape-cell')].map(c => ({
          name: (c.querySelector('.cape-name') || {}).textContent || null,
          state: (c.querySelector('.cape-state') || {}).textContent || null,
          active: c.classList.contains('active'),
          preview: c.classList.contains('preview')
        }))
        const applyBtn = [...modal.querySelectorAll('.cape-actions button')].map(b => b.textContent + ':' + b.disabled)
        return { capes: cells, actions: applyBtn }
      })()`)
      console.log('cape gallery:', JSON.stringify(c3))
      await js(`(() => {
        const cell = [...document.querySelectorAll('#modal-root .modal .cape-cell')].find(c => !c.classList.contains('active'))
        cell.click()
      })()`)
      await sleep(300)
      const c3b = await js(`(() => {
        const modal = document.querySelector('#modal-root .modal')
        const cells = [...modal.querySelectorAll('.cape-cell')].map(c => ({
          name: (c.querySelector('.cape-name') || {}).textContent || null,
          state: (c.querySelector('.cape-state') || {}).textContent || null,
          preview: c.classList.contains('preview')
        }))
        const status = [...modal.querySelectorAll('.cape-actions .hint')].map(h => h.textContent)
        const applyBtn = [...modal.querySelectorAll('.cape-actions button')].map(b => b.textContent + ':' + b.disabled)
        const cv = modal.querySelector('.skin-box .skin-3d-canvas')
        const v = cv && cv.__viewer
        let capePx = null
        if (v) {
          v.playerObject.rotation.y = Math.PI
          v.renderer.render(v.scene, v.camera)
          const gl = v.renderer.getContext()
          const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
          const buf = new Uint8Array(w * h * 4)
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
          let nz = 0
          for (let i = 3; i < buf.length; i += 4) if (buf[i] > 0) nz++
          v.playerObject.rotation.y = 0
          capePx = 'backPixels=' + nz + ' capeVisible=' + (v.playerObject.cape ? v.playerObject.cape.visible : 'n/a')
        }
        return { capes: cells, status: status, actions: applyBtn, capePx: capePx }
      })()`)
      console.log('cape preview select:', JSON.stringify(c3b))
      await js(`(() => {
        const btn = [...document.querySelectorAll('#modal-root .modal .cape-actions button')].find(b => b.textContent === 'Apply Cape')
        btn.click()
      })()`)
      await sleep(500)
      const c4 = await js(`(() => {
        const modal = document.querySelector('#modal-root .modal')
        const cells = [...modal.querySelectorAll('.cape-cell')].map(c => ({
          name: (c.querySelector('.cape-name') || {}).textContent || null,
          state: (c.querySelector('.cape-state') || {}).textContent || null,
          active: c.classList.contains('active'),
          preview: c.classList.contains('preview')
        }))
        return { capes: cells }
      })()`)
      console.log('cape after apply:', JSON.stringify(c4))
      await js(`(() => {
        const btn = [...document.querySelectorAll('#modal-root .modal .skin-actions button')].find(b => b.textContent === 'Choose New Skin')
        btn.click()
      })()`)
      await sleep(500)
      const s5 = await js(`(() => {
        const modal = document.querySelector('#modal-root .modal')
        const canvases = [...modal.querySelectorAll('.skin-box .skin-3d-canvas')].length
        const empty = [...modal.querySelectorAll('.skin-box .skin-empty')].map(e => e.textContent)
        const apply = [...modal.querySelectorAll('.skin-actions button')].find(b => b.textContent === 'Apply New Skin')
        return { canvasCount: canvases, empty: empty, applyEnabled: apply && !apply.disabled }
      })()`)
      console.log('new skin preview:', JSON.stringify(s5))
      await js(`(() => {
        const btn = [...document.querySelectorAll('#modal-root .modal .skin-actions button')].find(b => b.textContent === 'Apply New Skin')
        btn.click()
      })()`)
      await sleep(500)
      const s6 = await js(`(() => {
        const modal = document.querySelector('#modal-root .modal')
        const badges = [...modal.querySelectorAll('.skin-label .badge')].map(b => b.textContent)
        const empty = [...modal.querySelectorAll('.skin-box .skin-empty')].map(e => e.textContent)
        const apply = [...modal.querySelectorAll('.skin-actions button')].find(b => b.textContent === 'Apply New Skin')
        return { badges: badges, empty: empty, applyDisabled: apply ? apply.disabled : 'missing' }
      })()`)
      console.log('new skin applied:', JSON.stringify(s6))
      await js(`(() => {
        const btn = [...document.querySelectorAll('#modal-root .modal .skin-actions button')].find(b => b.textContent === 'Remove Skin')
        btn.click()
      })()`)
      await sleep(500)
      const s4 = await js(`(() => {
        const modal = document.querySelector('#modal-root .modal')
        return { skinRemoved: !!modal && !modal.querySelector('.skin-preview'), emptyShown: !!modal && !!modal.querySelector('.skin-empty') }
      })()`)
      console.log('skin modal remove:', JSON.stringify(s4))
      await js(`document.querySelector('#modal-root .modal .close').click()`)
      await sleep(200)

      // ---- skin & cape entry in the account chip for a microsoft account ----
      const msId = accounts.list().find(a => a.type === 'microsoft').id
      await js(`(async () => { await api.accounts.setSelected(${JSON.stringify(msId)}); renderUserChip() })()`)
      await sleep(300)
      await js(`document.querySelector('.user-chip-btn').click()`)
      await sleep(200)
      const c1 = await js(`(() => ({
        items: [...document.querySelectorAll('.user-chip-item')].map(i => i.textContent).filter(t => t)
      }))()`)
      console.log('chip with ms account:', JSON.stringify(c1))
      await js(`(() => { [...document.querySelectorAll('.user-chip-item')].find(i => i.textContent === 'Skin & Cape').click() })()`)
      await sleep(600)
      const c2 = await js(`(() => { const m = document.querySelector('#modal-root .modal'); return { open: !!m, title: m ? m.querySelector('h3').textContent : null } })()`)
      console.log('chip skin modal:', JSON.stringify(c2))
      await js(`document.querySelector('#modal-root .modal .close').click()`)
      await sleep(200)

      // ---- hero 3D character (skinview3d) + instance selection ----
      await js(`(async () => { await api.accounts.setSelected(${JSON.stringify(msId)}); renderUserChip(); renderHero() })()`)
      await sleep(900)
      const h1 = await js(`(() => {
        const charEl = document.querySelector('#hero-character')
        const c = charEl && charEl.querySelector('.hero-skin-canvas')
        const v = charEl && charEl.__viewer
        const census = () => {
          v.renderer.render(v.scene, v.camera)
          const gl = v.renderer.getContext()
          const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
          const buf = new Uint8Array(w * h * 4)
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
          let red = 0, blue = 0, green = 0, opaque = 0
          for (let i = 0; i < buf.length; i += 4) {
            if (buf[i + 3] === 0) continue
            opaque++
            const r = buf[i], g = buf[i + 1], b = buf[i + 2]
            if (r > g && r > b) red++
            else if (b > r && b > g) blue++
            else if (g > r && g > b) green++
          }
          return { red, blue, green, opaque }
        }
        const yawNow = v ? +v.playerObject.rotation.y.toFixed(3) : null
        const yaw0 = census()
        v.playerObject.rotation.y = Math.PI
        const yawPi = census()
        v.playerObject.rotation.y = 0
        return {
          svLoaded: !!window.skinview3d,
          hasCanvas: !!c,
          canvasBacking: c ? [c.width, c.height] : null,
          cssSize: c ? [getComputedStyle(c).width, getComputedStyle(c).height] : null,
          modelLoaded: v ? v.playerObject.skin.visible : false,
          yaw: yawNow,
          zoom: v ? +v.zoom.toFixed(2) : null,
          autoRotate: v ? v.autoRotate : null,
          cameraY: v ? +v.camera.position.y.toFixed(2) : null,
          yaw0: yaw0,
          yawPi: yawPi,
          heroTitle: document.querySelector('#hero-title').textContent,
          heroBtn: document.querySelector('#hero-actions .btn.primary').textContent,
          heroHasInstancesPill: document.querySelector('#hero-meta').textContent.includes('instance'),
          selectedCard: !![...document.querySelectorAll('#instance-grid .card.selected')].length
        }
      })()`)
      console.log('hero 3d:', JSON.stringify(h1))

      await js(`(() => { document.querySelector('#instance-grid .card .card-top').click() })()`)
      await sleep(600)
      const h2 = await js(`(() => ({
        heroTitle: document.querySelector('#hero-title').textContent,
        heroBtn: document.querySelector('#hero-actions .btn.primary').textContent,
        selectedCard: !![...document.querySelectorAll('#instance-grid .card.selected')].length,
        selectedName: (document.querySelector('#instance-grid .card.selected .card-title') || {}).textContent || null
      }))()`)
      console.log('hero selected:', JSON.stringify(h2))

      // switch from microsoft to offline: stale MS canvas must be gone, fallback shows username + Offline
      const offId = await js(`(async () => (await api.accounts.addOffline('ProbeUser')).id)()`)
      await js(`(async () => { await api.accounts.setSelected(${JSON.stringify(offId)}); renderUserChip(); renderHero() })()`)
      await sleep(500)
      const o1 = await js(`(() => {
        const charEl = document.querySelector('#hero-character')
        return {
          hasCanvas: !!charEl.querySelector('.hero-skin-canvas'),
          hasEmpty: !!charEl.querySelector('.hero-character-empty'),
          name: (charEl.querySelector('.hero-character-name') || {}).textContent || null,
          type: (charEl.querySelector('.hero-character-type') || {}).textContent || null,
          viewer: !!charEl.__viewer
        }
      })()`)
      console.log('hero offline fallback:', JSON.stringify(o1))

      // offline account whose username exists on Mojang: show that username's skin
      const offSkinId = await js(`(async () => (await api.accounts.addOffline('SkinUser')).id)()`)
      await js(`(async () => { await api.accounts.setSelected(${JSON.stringify(offSkinId)}); renderUserChip(); renderHero() })()`)
      await sleep(900)
      const o2 = await js(`(() => {
        const charEl = document.querySelector('#hero-character')
        const c = charEl && charEl.querySelector('.hero-skin-canvas')
        const v = charEl && charEl.__viewer
        const census = () => {
          v.renderer.render(v.scene, v.camera)
          const gl = v.renderer.getContext()
          const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
          const buf = new Uint8Array(w * h * 4)
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
          let red = 0, opaque = 0
          for (let i = 0; i < buf.length; i += 4) {
            if (buf[i + 3] === 0) continue
            opaque++
            if (buf[i] > buf[i + 2] && buf[i] > buf[i + 1]) red++
          }
          return { red, opaque }
        }
        return {
          hasCanvas: !!c,
          hasEmpty: !!charEl.querySelector('.hero-character-empty'),
          modelLoaded: v ? v.playerObject.skin.visible : false,
          yaw: v ? +v.playerObject.rotation.y.toFixed(3) : null,
          census: census()
        }
      })()`)
      console.log('hero offline skin:', JSON.stringify(o2))

      // ---- instance tools: icon, logs, mods ----
      const instId = await js(`(async () => (await api.instances.list()).find(i => i.name === 'ProbeInst').id)()`)
      await js(`(async () => { await api.instances.update(${JSON.stringify(instId)}, { icon: 'data:image/png;base64,AAAA' }); renderInstances() })()`)
      await sleep(400)
      const ic1 = await js(`(() => {
        const card = [...document.querySelectorAll('#instance-grid .card')].find(c => c.textContent.includes('ProbeInst'))
        const img = card && card.querySelector('.card-icon')
        return { customIcon: img ? img.src.startsWith('data:image') : false, src: img ? img.src.slice(0, 30) : null }
      })()`)
      console.log('instance icon on card:', JSON.stringify(ic1))

      await js(`(() => {
        const card = [...document.querySelectorAll('#instance-grid .card')].find(c => c.textContent.includes('ProbeInst'))
        ;[...card.querySelectorAll('button')].find(b => b.textContent === 'Edit').click()
      })()`)
      await sleep(500)
      const t1 = await js(`(() => {
        const m = document.querySelector('#modal-root .modal')
        return {
          hasIconRow: !!m.querySelector('.icon-row'),
          iconPreviewSrc: ((m.querySelector('.icon-preview') || {}).src || '').slice(0, 30),
          tools: [...m.querySelectorAll('.instance-tools button')].map(b => b.textContent)
        }
      })()`)
      console.log('edit modal tools:', JSON.stringify(t1))

      await js(`(() => { [...document.querySelectorAll('#modal-root .modal .instance-tools button')].find(b => b.textContent.includes('Logs')).click() })()`)
      await sleep(1000)
      const l1 = await js(`(() => {
        const m = document.querySelector('#modal-root .modal')
        return {
          title: m.querySelector('h3').textContent,
          tabs: [...m.querySelectorAll('.tabs .tab')].map(t => t.textContent),
          hasView: !!m.querySelector('.logs-view'),
          status: m.querySelector('.hint').textContent
        }
      })()`)
      console.log('logs modal:', JSON.stringify(l1))
      await js(`document.querySelector('#modal-root .modal .close').click()`)
      await sleep(300)

      fs.writeFileSync(path.join(probeRoot, 'fake-mod.jar'), 'jar')
      const irisDest = path.join(mods.modsDir(instId), 'iris-fabric-mc1.19.2-1.6.1.jar')
      fs.mkdirSync(path.dirname(irisDest), { recursive: true })
      fs.writeFileSync(irisDest, 'jar')
      await js(`(() => {
        const card = [...document.querySelectorAll('#instance-grid .card')].find(c => c.textContent.includes('ProbeInst'))
        ;[...card.querySelectorAll('button')].find(b => b.textContent === 'Edit').click()
      })()`)
      await sleep(400)
      await js(`(() => { [...document.querySelectorAll('#modal-root .modal .instance-tools button')].find(b => b.textContent.includes('Mods')).click() })()`)
      await sleep(800)
      const mod1 = await js(`(() => {
        const m = document.querySelector('#modal-root .modal')
        return {
          installed: [...m.querySelectorAll('.mods-installed .mod-row')].map(r => r.textContent),
          tabs: [...m.querySelectorAll('.tabs .tab')].map(t => t.textContent),
          sectionTitles: [...m.querySelectorAll('.mods-section-title')].map(t => t.textContent)
        }
      })()`)
      console.log('mods modal:', JSON.stringify(mod1))

      await js(`(() => {
        const tabs = [...document.querySelectorAll('#modal-root .modal .tabs .tab')]
        tabs.find(t => t.textContent === 'Custom JAR').click()
      })()`)
      await sleep(200)
      await js(`(() => { [...document.querySelectorAll('#modal-root .modal button')].find(b => b.textContent === 'Choose JAR...').click() })()`)
      await sleep(500)
      const mod2 = await js(`(() => ({
        installed: [...document.querySelectorAll('#modal-root .modal .mods-installed .mod-row')].map(r => r.textContent),
        hint: [...document.querySelectorAll('#modal-root .modal .hint')].map(h => h.textContent).filter(Boolean).pop()
      }))()`)
      console.log('mods custom install:', JSON.stringify(mod2))

      await js(`(() => {
        const tabs = [...document.querySelectorAll('#modal-root .modal .tabs .tab')]
        tabs.find(t => t.textContent === 'Modrinth').click()
        const panel = document.querySelector('#modal-root .modal .mods-sources')
        const input = panel.querySelector('input')
        input.value = 'probe'
      })()`)
      await sleep(200)
      const dbg1 = await js(`(() => ({
        sourceButtons: [...document.querySelectorAll('#modal-root .modal .mods-sources button')].map(b => b.textContent),
        resultText: (document.querySelector('#modal-root .modal .mod-results') || {}).textContent || '(no result box)'
      }))()`)
      console.log('mods modrinth prep:', JSON.stringify(dbg1))
      await js(`(() => { const panel = document.querySelector('#modal-root .modal .mods-sources'); ;[...panel.querySelectorAll('button')].find(b => b.textContent === 'Search').click() })()`)
      await sleep(700)
      const dbg2 = await js(`(() => ({
        cards: [...document.querySelectorAll('#modal-root .modal .mod-card')].map(c => ({
          name: (c.querySelector('.mod-card-name') || {}).textContent,
          dev: (c.querySelector('.mod-card-dev') || {}).textContent,
          desc: (c.querySelector('.mod-card-desc') || {}).textContent,
          action: (c.querySelector('.install-action') || {}).textContent
        }))
      }))()`)
      console.log('mods modrinth search:', JSON.stringify(dbg2))
      await js(`(() => {
        const box = document.querySelector('#modal-root .modal .mod-results')
        box.scrollTop = box.scrollHeight
        box.dispatchEvent(new Event('scroll'))
      })()`)
      await sleep(600)
      const dbgScroll = await js(`(() => ({
        cards: [...document.querySelectorAll('#modal-root .modal .mod-card .mod-card-name')].map(n => n.textContent),
        hints: [...document.querySelectorAll('#modal-root .modal .mod-results .hint')].map(h => h.textContent)
      }))()`)
      console.log('mods modrinth infinite scroll:', JSON.stringify(dbgScroll))
      await js(`(() => { [...document.querySelectorAll('#modal-root .modal .mod-card .install-action')].find(b => b.textContent === 'Install').click() })()`)
      await sleep(600)
      const dbg3 = await js(`(() => ({
        title: (document.querySelector('#modal-root .version-picker .inline-prompt-title') || {}).textContent,
        sub: (document.querySelector('#modal-root .version-picker-sub') || {}).textContent,
        items: [...document.querySelectorAll('#modal-root .version-pick-item')].map(i => ({
          text: i.textContent,
          selected: i.classList.contains('selected'),
          disabled: i.disabled
        }))
      }))()`)
      console.log('mods modrinth version picker:', JSON.stringify(dbg3))
      await js(`(() => { [...document.querySelectorAll('#modal-root .version-picker .inline-prompt-actions .btn.primary')][0].click() })()`)
      await sleep(150)
      const pickerInst = await js(`(() => {
        const box = document.querySelector('#modal-root .version-picker')
        return {
          pickerGone: !box,
          installingText: box ? (box.querySelector('.version-picker-installing .version-picker-sub') || {}).textContent : null,
          installingClass: box ? !!box.querySelector('.version-picker-installing') : false,
          spinner: box ? !!box.querySelector('.spinner') : false
        }
      })()`)
      console.log('mods modrinth installing-state:', JSON.stringify(pickerInst))
      await sleep(900)
      const mod3 = await js(`(() => ({
        installed: [...document.querySelectorAll('#modal-root .modal .mods-installed .mod-row')].map(r => r.textContent),
        hint: [...document.querySelectorAll('#modal-root .modal .hint')].map(h => h.textContent).filter(Boolean).pop(),
        pickerClosed: !document.querySelector('#modal-root .version-picker')
      }))()`)
      console.log('mods modrinth install:', JSON.stringify(mod3))
      const instRows = await js(`(() => ({
        rows: [...document.querySelectorAll('#modal-root .modal .mods-installed .mod-row')].map(r => ({
          text: r.textContent,
          img: (() => { const i = r.querySelector('.mod-inst-icon'); return i ? (i.src || '').slice(0, 30) : null })(),
          placeholder: !!r.querySelector('.mod-inst-icon.placeholder')
        }))
      }))()`)
      console.log('mods installed icons:', JSON.stringify(instRows))
      const dbgInst = await js(`(() => ({
        installedCards: [...document.querySelectorAll('#modal-root .modal .mod-card.installed .mod-card-name')].map(n => n.textContent),
        badges: document.querySelectorAll('#modal-root .modal .mod-card .installed-badge').length,
        actions: [...document.querySelectorAll('#modal-root .modal .mod-card .install-action')].map(b => b.textContent + ':' + b.disabled)
      }))()`)
      console.log('mods modrinth installed-state:', JSON.stringify(dbgInst))

      // ---- cancel a mod install: button visible, abort removes the partial file ----
      const p2 = path.join(mods.modsDir(instId), 'probe-modrinth-mod-1.0.0.jar')
      await js(`(() => {
        const card = [...document.querySelectorAll('#modal-root .modal .mod-card')].find(c => (c.querySelector('.mod-card-name') || {}).textContent === 'Probe Modrinth Mod 2')
        ;[...card.querySelectorAll('.install-action')].find(b => b.textContent === 'Install').click()
      })()`)
      await sleep(600)
      await js(`(() => { [...document.querySelectorAll('#modal-root .version-picker .inline-prompt-actions .btn.primary')][0].click() })()`)
      await sleep(150)
      const cancelVis = await js(`(() => ({
        progressOpen: document.querySelector('#progress-root').classList.contains('open'),
        cancelShown: !!document.querySelector('#progress-root .progress-cancel'),
        sub: (document.querySelector('#progress-root .progress-sub') || {}).textContent
      }))()`)
      console.log('mods cancel visible:', JSON.stringify(cancelVis))
      await js(`document.querySelector('#progress-root .progress-cancel').click()`)
      await sleep(700)
      const cancelRes = await js(`(() => ({
        progressClosed: !document.querySelector('#progress-root').classList.contains('open'),
        hint: [...document.querySelectorAll('#modal-root .modal .hint')].map(h => h.textContent).filter(Boolean).pop(),
        pickerClosed: !document.querySelector('#modal-root .version-picker'),
        cardAction: (() => {
          const card = [...document.querySelectorAll('#modal-root .modal .mod-card')].find(c => (c.querySelector('.mod-card-name') || {}).textContent === 'Probe Modrinth Mod 2')
          const b = card && card.querySelector('.install-action')
          return b ? b.textContent : 'n/a'
        })()
      }))()`)
      console.log('mods cancel result:', JSON.stringify(cancelRes))
      console.log('mods cancel partial cleaned:', JSON.stringify({ partExists: fs.existsSync(p2 + '.part') }))

      await js(`(() => {
        const tabs = [...document.querySelectorAll('#modal-root .modal .tabs .tab')]
        tabs.find(t => t.textContent === 'Modrinth').click()
        const panel = document.querySelector('#modal-root .modal .mods-sources')
        const input = panel.querySelector('input')
        input.value = 'iris'
        ;[...panel.querySelectorAll('button')].find(b => b.textContent === 'Search').click()
      })()`)
      await sleep(700)
      const dbgIris = await js(`(() => ({
        cards: [...document.querySelectorAll('#modal-root .modal .mod-card')].map(c => ({
          name: (c.querySelector('.mod-card-name') || {}).textContent,
          action: (c.querySelector('.install-action') || {}).textContent,
          disabled: (c.querySelector('.install-action') || {}).disabled
        }))
      }))()`)
      console.log('mods iris detection:', JSON.stringify(dbgIris))

      await js(`(() => {
        const tabs = [...document.querySelectorAll('#modal-root .modal .tabs .tab')]
        tabs.find(t => t.textContent === 'CurseForge').click()
        const panel = document.querySelector('#modal-root .modal .mods-sources')
        const input = panel.querySelector('input')
        input.value = 'probe'
      })()`)
      await sleep(200)
      const dbg4 = await js(`(() => ({
        cards: [...document.querySelectorAll('#modal-root .modal .mod-card')].map(c => c.textContent)
      }))()`)
      console.log('mods curseforge prep:', JSON.stringify(dbg4))
      await js(`(() => { const panel = document.querySelector('#modal-root .modal .mods-sources'); ;[...panel.querySelectorAll('button')].find(b => b.textContent === 'Search').click() })()`)
      await sleep(700)
      const dbg5 = await js(`(() => ({
        cards: [...document.querySelectorAll('#modal-root .modal .mod-card')].map(c => ({
          name: (c.querySelector('.mod-card-name') || {}).textContent,
          dev: (c.querySelector('.mod-card-dev') || {}).textContent,
          action: (c.querySelector('.install-action') || {}).textContent
        }))
      }))()`)
      console.log('mods curseforge search:', JSON.stringify(dbg5))
      await js(`(() => { [...document.querySelectorAll('#modal-root .modal .mod-card .install-action')].find(b => b.textContent === 'Install').click() })()`)
      await sleep(600)
      const dbg6 = await js(`(() => ({
        items: [...document.querySelectorAll('#modal-root .version-pick-item')].map(i => ({
          text: i.textContent,
          selected: i.classList.contains('selected')
        }))
      }))()`)
      console.log('mods curseforge version picker:', JSON.stringify(dbg6))
      await js(`(() => { [...document.querySelectorAll('#modal-root .version-picker .inline-prompt-actions .btn.primary')][0].click() })()`)
      await sleep(800)
      const mod4 = await js(`(() => ({
        installed: [...document.querySelectorAll('#modal-root .modal .mods-installed .mod-row')].map(r => r.textContent),
        hint: [...document.querySelectorAll('#modal-root .modal .hint')].map(h => h.textContent).filter(Boolean).pop()
      }))()`)
      console.log('mods curseforge install:', JSON.stringify(mod4))
      await js(`document.querySelector('#modal-root .modal .close').click()`)
      await sleep(200)

      // ---- Prism-style pack version sorting (MC newest first, then semver with prerelease tiers) ----
      const sortTest = await js(`(() => {
        const a = { game_versions: ['1.20.1'], version_number: '14.0.0-beta.4' }
        const b = { game_versions: ['1.20.1'], version_number: '14.0.0-beta.3' }
        const c = { game_versions: ['1.20.1'], version_number: '13.3.0' }
        const d = { game_versions: ['1.20'], version_number: '99.0.0' }
        const e = { game_versions: ['1.20.1'], version_number: '14.0.0' }
        const sorted = [c, b, a, e, d].sort(sortPackVersions)
        return sorted.map(v => v.version_number + '@' + v.game_versions[0])
      })()`)
      console.log('pack version sort:', JSON.stringify(sortTest))

      const mcSortTest = await js(`(() => {
        const list = ['1.20', '1.20.1', '1.19.4', '1.20.2', '1.8.9'].sort(cmpMcVersion)
        return list
      })()`)
      console.log('mc version sort:', JSON.stringify(mcSortTest))

      // ---- offline account head icon generator ----
      const headTest = await js(`(() => {
        const svg = makeOfflineHead('ProbeUser')
        return { isDataUrl: svg.indexOf('data:image/svg+xml;base64,') === 0 }
      })()`)
      console.log('offline head:', JSON.stringify(headTest))
    } catch (e) {
      console.log('PROBE ERROR:', e.message)
    }
    console.log('--- renderer errors:', errors.length ? errors.join('\n') : '(none)')
    app.exit(0)
  })
  win.loadFile(path.join(__dirname, '..', 'index.html'))
})
