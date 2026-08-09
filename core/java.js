'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')
const paths = require('./paths')
const util = require('./util')
const { spawnSync } = require('child_process')

const ADOPTIUM_API = 'https://api.adoptium.net'
const ORACLE_BASE = 'https://download.oracle.com/java'
const MOJANG_RUNTIME_HASH = '2ec0cc96c44e5a76b9c8b7c39df7210883d12871'
const MOJANG_RUNTIME_URL = 'https://launchermeta.mojang.com/v1/products/java-runtime/' + MOJANG_RUNTIME_HASH + '/all.json'
const MOJANG_MAJORS = {
  'jre-legacy': 8,
  'java-runtime-alpha': 16,
  'java-runtime-beta': 17,
  'java-runtime-gamma': 17,
  'java-runtime-gamma-snapshot': 17,
  'java-runtime-delta': 21,
  'java-runtime-epsilon': 25
}

function mojangOsKey () {
  if (process.platform === 'win32') {
    if (process.arch === 'arm64') return 'windows-arm64'
    if (process.arch === 'ia32') return 'windows-x86'
    return 'windows-x64'
  }
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os'
  return 'linux'
}

function javaExeName () {
  return process.platform === 'win32' ? 'java.exe' : 'java'
}

function getJavaVersion (javaPath) {
  try {
    const r = spawnSync(javaPath, ['-version'], { encoding: 'utf8', timeout: 15000 })
    const text = (r.stderr || '') + '\n' + (r.stdout || '')
    const m = text.match(/version\s+"([0-9]+)/)
    if (m) return parseInt(m[1], 10)
    const m2 = text.match(/version\s+1\.([0-9]+)/)
    if (m2) return parseInt(m2[1], 10)
    return null
  } catch {
    return null
  }
}

function uniqueJava (javaPath, list) {
  const norm = path.normalize(javaPath).toLowerCase()
  if (list.some(j => path.normalize(j.path).toLowerCase() === norm)) return
  const version = getJavaVersion(javaPath)
  if (version) list.push({ path: javaPath, version, isJre: /jre/i.test(javaPath) })
}

function scanDir (dir, list) {
  if (!fs.existsSync(dir)) return
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const p = path.join(dir, e.name)
    for (const sub of [p, path.join(p, 'bin')]) {
      const exe = path.join(sub, javaExeName())
      if (fs.existsSync(exe)) {
        uniqueJava(exe, list)
        return
      }
    }
  }
}

function scanJdkLayout (base, list) {
  if (!fs.existsSync(base)) return
  try {
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const p = path.join(base, e.name)
      const exe = path.join(p, 'bin', javaExeName())
      if (fs.existsSync(exe)) {
        uniqueJava(exe, list)
        continue
      }
      const exe2 = path.join(p, 'jre', 'bin', javaExeName())
      if (fs.existsSync(exe2)) uniqueJava(exe2, list)
      else scanDir(p, list)
    }
  } catch {}
}

function fromRegistry (list) {
  if (process.platform !== 'win32') return
  const roots = [
    'HKLM\\SOFTWARE\\JavaSoft\\JDK',
    'HKLM\\SOFTWARE\\JavaSoft\\Java Development Kit',
    'HKLM\\SOFTWARE\\JavaSoft\\Java Runtime Environment',
    'HKCU\\SOFTWARE\\JavaSoft\\JDK',
    'HKLM\\SOFTWARE\\Eclipse Adoptium\\JDK',
    'HKLM\\SOFTWARE\\Microsoft\\JavaVirtualMachine'
  ]
  for (const root of roots) {
    try {
      const r = spawnSync('reg', ['query', root, '/s', '/f', 'JavaHome', '/t', 'REG_SZ'], { encoding: 'utf8', timeout: 20000, windowsHide: true })
      if (r.status !== 0) continue
      const re = /JavaHome\s+REG_SZ\s+(.+)$/gm
      let m
      while ((m = re.exec(r.stdout))) {
        const dir = m[1].trim()
        const exe = path.join(dir, 'bin', javaExeName())
        if (fs.existsSync(exe)) uniqueJava(exe, list)
      }
    } catch {}
  }
}

function detectJava () {
  const list = []
  scanJdkLayout(path.join(paths.root(), 'java'), list)
  if (process.env.JAVA_HOME) {
    const exe = path.join(process.env.JAVA_HOME, 'bin', javaExeName())
    if (fs.existsSync(exe)) uniqueJava(exe, list)
  }
  try {
    const r = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [javaExeName()], { encoding: 'utf8', timeout: 10000 })
    if (r.status === 0) {
      for (const line of r.stdout.split(/\r?\n/).filter(Boolean)) uniqueJava(line.trim(), list)
    }
  } catch {}

  if (process.platform === 'win32') {
    const roots = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Java'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Java'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Eclipse Adoptium'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Eclipse Adoptium'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs'),
      path.join(process.env.LOCALAPPDATA || '', 'Java'),
      path.join(os.homedir(), '.jdks'),
      path.join(os.homedir(), 'scoop', 'apps'),
      'C:\\Program Files\\Common Files\\Oracle\\Java'
    ]
    for (const r of roots) scanJdkLayout(r, list)
    fromRegistry(list)
  } else {
    scanJdkLayout('/usr/lib/jvm', list)
    scanJdkLayout('/opt', list)
  }

  const seen = new Set()
  const out = []
  for (const j of list) {
    const key = path.normalize(j.path).toLowerCase()
    if (!seen.has(key)) { seen.add(key); out.push(j) }
  }
  out.sort((a, b) => (b.version || 0) - (a.version || 0))
  return out
}

function pickBest (detected) {
  if (!detected.length) return null
  const modern = detected.filter(j => (j.version || 0) >= 17)
  return modern[0] || detected[0]
}

function pickBestFor (detected, required) {
  if (!detected.length) return null
  const suited = detected.filter(j => (j.version || 0) >= (required || 0))
  if (!suited.length) return null
  suited.sort((a, b) => (a.version || 0) - (b.version || 0))
  return suited[0]
}

async function listProviderVersions (provider) {
  if (provider === 'adoptium') {
    try {
      const info = await util.getJson(ADOPTIUM_API + '/v3/info/available_releases')
      const all = info.available_releases || []
      const lts = info.available_lts_releases || []
      return all.map(m => ({ value: String(m), major: m, label: 'Java ' + m + (lts.includes(m) ? ' (LTS)' : '') }))
    } catch {
      return [8, 11, 16, 17, 21, 25].map(m => ({ value: String(m), major: m, label: 'Java ' + m }))
    }
  }
  if (provider === 'oracle') {
    return [17, 21, 25].map(m => ({ value: String(m), major: m, label: 'Java ' + m }))
  }
  if (provider === 'mojang') {
    try {
      const data = await util.getJson(MOJANG_RUNTIME_URL)
      const osData = data[mojangOsKey()] || {}
      const out = []
      for (const [component, builds] of Object.entries(osData)) {
        if (component === 'minecraft-java-exe') continue
        const build = Array.isArray(builds) && builds.length ? builds[0] : null
        if (!build) continue
        const major = MOJANG_MAJORS[component] || 21
        const name = build.version && build.version.name ? build.version.name : ''
        out.push({ value: component, component, major, label: 'Java ' + major + ' \u00b7 ' + component + (name ? ' (' + name + ')' : '') })
      }
      return out
    } catch {
      return Object.entries(MOJANG_MAJORS).map(([component, major]) => ({ value: component, component, major, label: 'Java ' + major + ' \u00b7 ' + component }))
    }
  }
  return []
}

async function downloadProvider (provider, value, onProgress) {
  if (provider === 'adoptium') return downloadJava(parseInt(value, 10), onProgress)
  if (provider === 'oracle') return downloadOracle(parseInt(value, 10), onProgress)
  if (provider === 'mojang') return downloadMojang(value, onProgress)
  throw new Error('Unknown Java provider: ' + provider)
}

async function downloadJava (major, onProgress) {
  const destDir = path.join(paths.root(), 'java')
  util.ensureDirSync(destDir)
  const existing = fs.existsSync(destDir) ? fs.readdirSync(destDir).filter(d => /jdk/i.test(d)) : []
  const existingExe = existing
    .map(d => path.join(destDir, d, 'bin', javaExeName()))
    .filter(p => fs.existsSync(p))
  if (existingExe.length) {
    const ver = getJavaVersion(existingExe[0])
    if (ver && (!major || ver === major)) return existingExe[0]
  }

  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'
  const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'aarch64' : 'x64'
  const url = `${ADOPTIUM_API}/v3/binary/latest/${major}/ga/${platform}/${arch}/jdk/hotspot/normal/eclipse`
  const zipPath = path.join(paths.cache(), `adoptium-jdk${major}-${platform}-${arch}.zip`)
  await util.download(url, zipPath, { onProgress })
  const extractDir = path.join(destDir, `jdk-${major}`)
  extractArchive(zipPath, extractDir)
  const exe = findJavaUnder(extractDir)
  if (!exe) throw new Error('Could not locate java after extraction')
  return exe
}

function oracleFileName (major) {
  if (process.platform === 'win32') {
    return 'jdk-' + major + (process.arch === 'ia32' ? '_windows-x86_bin.zip' : '_windows-x64_bin.zip')
  }
  if (process.platform === 'darwin') {
    return 'jdk-' + major + (process.arch === 'arm64' ? '_macos-aarch64_bin.tar.gz' : '_macos-x64_bin.tar.gz')
  }
  return 'jdk-' + major + (process.arch === 'arm64' ? '_linux-aarch64_bin.tar.gz' : '_linux-x64_bin.tar.gz')
}

async function downloadOracle (major, onProgress) {
  const destDir = path.join(paths.root(), 'java')
  util.ensureDirSync(destDir)
  const extractDir = path.join(destDir, 'oracle-jdk-' + major)
  const existing = findJavaUnder(extractDir)
  if (existing) {
    const ver = getJavaVersion(existing)
    if (ver === major) return existing
  }
  const fileName = oracleFileName(major)
  const zipPath = path.join(paths.cache(), 'oracle-jdk-' + major + '-' + fileName)
  await util.download(ORACLE_BASE + '/' + major + '/latest/' + fileName, zipPath, { onProgress })
  extractArchive(zipPath, extractDir)
  const exe = findJavaUnder(extractDir)
  if (!exe) throw new Error('Could not locate java after extraction')
  return exe
}

async function downloadMojang (component, onProgress) {
  const destDir = path.join(paths.root(), 'java', component)
  const exe = path.join(destDir, 'bin', javaExeName())
  if (fs.existsSync(exe)) {
    const ver = getJavaVersion(exe)
    if (ver) return exe
  }
  const data = await util.getJson(MOJANG_RUNTIME_URL)
  const osData = data[mojangOsKey()]
  const builds = osData && osData[component]
  const build = Array.isArray(builds) && builds.length ? builds[0] : null
  if (!build) throw new Error('Mojang runtime not available for this platform: ' + component)
  const files = await util.getJson(build.manifest.url)
  const entries = (files.files || {})
  const list = Object.entries(entries).filter(([, f]) => f && f.type === 'file')
  let i = 0
  for (const [p, f] of list) {
    const raw = f.downloads && f.downloads.raw
    if (!raw || !raw.url) continue
    const dest = path.join(destDir, p)
    if (util.exists(dest) && util.sha1File(dest) === raw.sha1) continue
    util.ensureDirSync(path.dirname(dest))
    await util.download(raw.url, dest)
    if (f.executable && process.platform !== 'win32') {
      try { fs.chmodSync(dest, 0o755) } catch {}
    }
    i++
    if (onProgress) onProgress({ received: i, total: list.length, dest, url: raw.url })
  }
  const found = fs.existsSync(exe) ? exe : findJavaUnder(destDir)
  if (!found) throw new Error('Could not locate java after runtime download')
  return found
}

async function ensureJavaFor (major, onProgress) {
  const found = detectJava().find(j => j.version === major)
  if (found) return found.path
  return downloadJava(major, onProgress)
}

function extractArchive (src, dest) {
  if (src.toLowerCase().endsWith('.zip')) { util.unzipTo(src, dest); return }
  const tmp = path.join(os.tmpdir(), 'nightly-tar-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7))
  util.ensureDirSync(tmp)
  const r = spawnSync('tar', ['-xf', src, '-C', tmp], { encoding: 'utf8', timeout: 300000, windowsHide: true })
  if (r.status !== 0) throw new Error('extract failed: ' + ((r.stderr || '').toString().trim() || 'tar error'))
  for (const entry of fs.readdirSync(tmp, { withFileTypes: true })) {
    const s = path.join(tmp, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) util.copyDir(s, d)
    else {
      util.ensureDirSync(path.dirname(d))
      fs.copyFileSync(s, d)
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true })
}

function findJavaUnder (dir) {
  for (const p of util.walk(dir)) {
    if (path.basename(p) === javaExeName()) return p
  }
  return null
}

module.exports = { detectJava, getJavaVersion, pickBest, pickBestFor, downloadJava, downloadProvider, downloadOracle, downloadMojang, listProviderVersions, ensureJavaFor, javaExeName }
