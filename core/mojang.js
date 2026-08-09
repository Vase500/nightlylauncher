'use strict'
const fs = require('fs')
const path = require('path')
const paths = require('./paths')
const config = require('./config')
const util = require('./util')

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const LIBRARY_BASE = 'https://libraries.minecraft.net/'
const ASSETS_BASE = 'https://resources.download.minecraft.net/'
const REPOS = [
  'https://libraries.minecraft.net/',
  'https://maven.fabricmc.net/',
  'https://maven.minecraftforge.net/',
  'https://maven.neoforged.net/releases/',
  'https://maven.quiltmc.org/repository/release/',
  'https://repo1.maven.org/maven2/'
]

let manifestCache = null

async function getManifest (force) {
  if (manifestCache && !force) return manifestCache
  const cacheFile = path.join(paths.cache(), 'version_manifest.json')
  try {
    if (!force && fs.existsSync(cacheFile) && Date.now() - fs.statSync(cacheFile).mtimeMs < 3600 * 1000 * 12) {
      manifestCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
      return manifestCache
    }
  } catch {}
  manifestCache = await util.getJson(MANIFEST_URL)
  try { fs.writeFileSync(cacheFile, JSON.stringify(manifestCache)) } catch {}
  return manifestCache
}

function manifestType (type) {
  switch (type) {
    case 'release': return 'releases'
    case 'snapshot': return 'snapshots'
    case 'old_beta': return 'betas'
    case 'old_alpha': return 'alphas'
    case 'experiment': return 'experiments'
    default: return type && type.includes('old') ? 'betas' : 'snapshots'
  }
}

async function listVersions (filters) {
  const man = await getManifest()
  const f = Object.assign({ releases: true, snapshots: true, betas: true, alphas: true, experiments: true }, filters || {})
  const map = { releases: 'releases', snapshots: 'snapshots', betas: 'betas', alphas: 'alphas', experiments: 'experiments' }
  return man.versions
    .filter(v => f[map[manifestType(v.type)]])
    .map(v => ({ id: v.id, type: v.type, releaseTime: v.releaseTime, url: v.url, category: manifestType(v.type) }))
}

async function fetchVersionJson (id, url) {
  const vdir = paths.versionDir(id)
  const vfile = path.join(vdir, id + '.json')
  if (fs.existsSync(vfile)) {
    try { return JSON.parse(fs.readFileSync(vfile, 'utf8')) } catch {}
  }
  if (!url) {
    const man = await getManifest()
    const entry = man.versions.find(v => v.id === id)
    if (!entry) throw new Error('Unknown version: ' + id)
    url = entry.url
  }
  const data = await util.getJson(url)
  util.ensureDirSync(vdir)
  fs.writeFileSync(vfile, JSON.stringify(data, null, 2))
  return data
}

async function getVersionJson (id) {
  return fetchVersionJson(id, null)
}

function ruleAllowed (rule) {
  if (rule.os) {
    const os = util.osName()
    if (rule.os.name && rule.os.name !== os) return false
    if (rule.os.arch) {
      const arch = process.arch
      const ok = (rule.os.arch === 'x86' && (arch === 'ia32' || arch === 'x64')) ||
        (rule.os.arch === 'x86_64' && arch === 'x64') ||
        (rule.os.arch === 'arm64' && arch === 'arm64')
      if (!ok) return false
    }
  }
  return true
}

function libAllowed (lib) {
  if (!lib.rules || lib.rules.length === 0) return true
  let allowed = false
  for (const rule of lib.rules) {
    if (ruleAllowed(rule)) allowed = rule.action !== 'disallow'
  }
  return allowed
}

function libName (lib) {
  return (lib.name || lib).split('@')[0]
}

function libClassifier (lib) {
  const natives = lib.natives && lib.natives[util.osName()]
  if (!natives) return null
  return natives.replace('${arch}', util.archName())
}

async function resolveVersionTree (id) {
  const seen = new Set()
  const order = []
  let current = id
  for (let i = 0; i < 10; i++) {
    if (seen.has(current)) break
    seen.add(current)
    const vjson = await getVersionJson(current)
    order.unshift(vjson)
    if (vjson.inheritsFrom) current = vjson.inheritsFrom
    else break
  }
  return order
}

function collectLibraries (tree) {
  const out = []
  const seen = new Set()
  for (const v of tree) {
    for (const lib of (v.libraries || [])) {
      if (!libAllowed(lib)) continue
      const key = libName(lib) + (libClassifier(lib) ? ':' + libClassifier(lib) : '')
      if (seen.has(key)) continue
      seen.add(key)
      out.push(lib)
    }
  }
  return out
}

function libUrl (lib) {
  return libUrls(lib)[0]
}

function libUrls (lib) {
  const d = lib.downloads && lib.downloads.artifact
  const urls = []
  if (d && d.url) urls.push(d.url)
  const parts = libName(lib).split(':')
  const group = parts[0].replace(/\./g, '/')
  const artifact = parts[1]
  const version = parts[2]
  const classifier = libClassifier(lib)
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.jar`
  const rel = `${group}/${artifact}/${version}/${file}`
  if (lib.url) urls.push(lib.url.replace(/\/+$/, '') + '/' + rel)
  if (!urls.length || !(d && d.url)) {
    for (const repo of REPOS) {
      urls.push(repo + rel)
    }
  }
  return urls
}

function libLocalPath (lib) {
  const d = lib.downloads && lib.downloads.artifact
  if (d && d.path) return path.join(paths.libraries(), d.path)
  const parts = libName(lib).split(':')
  const group = parts[0].replace(/\./g, '/')
  const artifact = parts[1]
  const version = parts[2]
  const classifier = libClassifier(lib)
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.jar`
  return path.join(paths.libraries(), group, artifact, version, file)
}

function libClassifierPath (lib) {
  const cl = libClassifier(lib)
  const dc = lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[cl]
  if (dc && dc.path) return path.join(paths.libraries(), dc.path)
  const d = lib.downloads && lib.downloads[cl]
  if (d && d.path) return path.join(paths.libraries(), d.path)
  const parts = libName(lib).split(':')
  const group = parts[0].replace(/\./g, '/')
  const artifact = parts[1]
  const version = parts[2]
  return path.join(paths.libraries(), group, artifact, version, `${artifact}-${version}-${cl}.jar`)
}

function nativeExtract (lib) {
  const legacyCl = lib.natives && lib.natives[util.osName()]
  const parts = libName(lib).split(':')
  const modernCl = parts.length >= 4 && /^natives[-_]/.test(parts[3]) ? parts[3] : null
  const cl = legacyCl || modernCl
  if (!cl) return null
  if (legacyCl && lib.downloads && lib.downloads[cl]) {
    const d = lib.downloads[cl]
    return { cl, url: d.url, sha1: d.sha1, size: d.size, jarLocalPath: path.join(paths.libraries(), d.path) }
  }
  if (legacyCl) {
    const dc = lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[cl]
    if (dc) {
      return { cl, url: dc.url, sha1: dc.sha1, size: dc.size, jarLocalPath: path.join(paths.libraries(), dc.path) }
    }
    return { cl, url: libUrl(lib), sha1: null, size: null, jarLocalPath: libClassifierPath(lib) }
  }
  const a = lib.downloads && lib.downloads.artifact
  return { cl, url: a && a.url, sha1: a && a.sha1, size: a && a.size, jarLocalPath: libLocalPath(lib) }
}

function nativesDir (versionId) {
  return path.join(paths.versionDir(versionId), 'natives-' + util.osName() + '-' + util.archName())
}

async function downloadFileIfMissing (urlOrUrls, dest, { expectedSha1, expectedSize, onProgress, signal } = {}) {
  if (util.exists(dest) && expectedSize && fs.statSync(dest).size === expectedSize) {
    if (!expectedSha1) return false
    if (await util.sha1File(dest) === expectedSha1) return false
  }
  if (util.exists(dest) && expectedSha1 && !expectedSize) {
    if (await util.sha1File(dest) === expectedSha1) return false
  }
  const urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls]
  let lastErr = null
  for (const url of urls) {
    if (!url) continue
    try {
      await util.download(url, dest, { onProgress, signal })
      if (expectedSha1) {
        const actual = await util.sha1File(dest)
        if (actual !== expectedSha1) throw new Error(`Checksum mismatch for ${path.basename(dest)}`)
      }
      return true
    } catch (e) {
      if (e.cancelled) throw e
      lastErr = e
      try { fs.rmSync(dest, { force: true }) } catch {}
    }
  }
  throw new Error(`Failed to download ${path.basename(dest)}: ${lastErr ? lastErr.message : 'no URLs'}`)
}

async function installLibraries (libs, onProgress, signal) {
  const natives = []
  const total = libs.length
  let done = 0
  const poolSize = 8
  let idx = 0
  const queue = []
  const worker = async () => {
    while (idx < libs.length) {
      if (signal && signal.aborted) throw util.cancelledError()
      const lib = libs[idx++]
      const name = libName(lib)
      const n = nativeExtract(lib)
      try {
        if (n) {
          await downloadFileIfMissing(n.url, n.jarLocalPath, { expectedSha1: n.sha1, expectedSize: n.size, onProgress, signal })
        } else {
          await downloadFileIfMissing(libUrls(lib), libLocalPath(lib), {
            expectedSha1: lib.downloads && lib.downloads.artifact && lib.downloads.artifact.sha1,
            expectedSize: lib.downloads && lib.downloads.artifact && lib.downloads.artifact.size,
            onProgress,
            signal
          })
        }
      } catch (e) {
        if (e.cancelled) throw e
        if (onProgress) onProgress({ phase: 'warn', message: `Skipped ${name}: ${e.message}` })
      }
      if (n) natives.push(n)
      done++
      if (onProgress) onProgress({ phase: 'libraries', done, total, item: name })
    }
  }
  for (let i = 0; i < poolSize; i++) queue.push(worker())
  await Promise.all(queue)
  return natives
}

async function installGameJar (versionId, tree, onProgress, signal) {
  const baseJson = tree[0]
  const dl = baseJson.downloads && baseJson.downloads.client
  if (!dl) throw new Error('Version has no client download: ' + versionId)
  const dest = path.join(paths.versionDir(versionId), versionId + '.jar')
  await downloadFileIfMissing(dl.url, dest, { expectedSha1: dl.sha1, expectedSize: dl.size, onProgress, signal })
  return dest
}

async function installAssets (tree, onProgress, signal) {
  const rootJson = tree[0]
  const idx = rootJson.assetIndex
  if (!idx) return null
  const indexFile = path.join(paths.assetsIndexes(), idx.id + '.json')
  await downloadFileIfMissing(idx.url, indexFile, { expectedSha1: idx.sha1, expectedSize: idx.size, onProgress, signal })
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
  const objects = Object.keys(index.objects || {})
  const total = objects.length
  let done = 0
  const poolSize = 12
  let i = 0
  const workers = []
  const worker = async () => {
    while (i < objects.length) {
      if (signal && signal.aborted) throw util.cancelledError()
      const key = objects[i++]
      const obj = index.objects[key]
      const dest = path.join(paths.assetsObjects(), obj.hash.slice(0, 2), obj.hash)
      if (util.exists(dest)) {
        try {
          if (fs.statSync(dest).size === obj.size) { done++; continue }
        } catch {}
      }
      try {
        await util.download(ASSETS_BASE + obj.hash.slice(0, 2) + '/' + obj.hash, dest, { onProgress, signal })
      } catch (e) {
        if (e.cancelled) throw e
      }
      done++
      if (onProgress) onProgress({ phase: 'assets', done, total, item: key })
    }
  }
  for (let k = 0; k < poolSize; k++) workers.push(worker())
  await Promise.all(workers)
  return idx.id
}

async function installNatives (versionId, natives, onProgress, signal) {
  if (!natives.length) return
  const dir = nativesDir(versionId)
  util.ensureDirSync(dir)
  for (const { cl, url, sha1, size, jarLocalPath } of natives) {
    try {
      await downloadFileIfMissing(url, jarLocalPath, { expectedSha1: sha1, expectedSize: size, onProgress, signal })
      const stamp = jarLocalPath + '.unpacked'
      if (!util.exists(stamp)) {
        util.unzipTo(jarLocalPath, dir)
        fs.writeFileSync(stamp, 'ok')
      }
    } catch (e) {
      if (e.cancelled) throw e
      if (onProgress) onProgress({ phase: 'warn', message: `Natives ${cl}: ${e.message}` })
    }
  }
}

async function ensureVersionInstalled (versionId, onProgress, signal) {
  const tree = await resolveVersionTree(versionId)
  const rootJson = tree[tree.length - 1]
  if (onProgress) onProgress({ phase: 'start', message: 'Installing ' + versionId })
  const libs = collectLibraries(tree)
  const natives = await installLibraries(libs, onProgress, signal)
  await installGameJar(versionId, tree, onProgress, signal)
  await installAssets(tree, onProgress, signal)
  await installNatives(versionId, natives, onProgress, signal)
  if (signal && signal.aborted) throw util.cancelledError()
  fs.writeFileSync(path.join(paths.versionDir(versionId), '.installed'), JSON.stringify({
    versionId, root: rootJson.id, time: Date.now()
  }))
  return { versionId, tree, libs }
}

function isVersionInstalled (versionId) {
  return util.exists(path.join(paths.versionDir(versionId), '.installed'))
}

async function versionConfig (versionId) {
  const tree = await resolveVersionTree(versionId)
  const rootJson = tree[tree.length - 1]
  return {
    id: versionId,
    mainClass: tree[tree.length - 1].mainClass,
    javaVersion: rootJson.javaVersion ? rootJson.javaVersion.majorVersion : null,
    inheritsFrom: rootJson.inheritsFrom || null
  }
}

module.exports = {
  MANIFEST_URL, getManifest, listVersions, getVersionJson, resolveVersionTree,
  collectLibraries, libAllowed, libUrl, libLocalPath, libClassifierPath, nativesDir, installLibraries,
  installGameJar, installAssets, installNatives, ensureVersionInstalled, isVersionInstalled,
  versionConfig, manifestType
}
