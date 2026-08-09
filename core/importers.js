'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')
const paths = require('./paths')
const config = require('./config')
const util = require('./util')
const instances = require('./instances')
const loaders = require('./loaders')
const curseforge = require('./curseforge')

function defaultDownloadDir () {
  return path.join(os.homedir(), 'Downloads')
}

function safeTarget (base, rel) {
  const normalized = path.normalize(rel).replace(/^([/\\])+/, '')
  if (normalized === '..' || normalized.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error('Unsafe pack path: ' + rel)
  }
  return path.join(base, normalized)
}

async function downloadPackMods (files, instanceDir, onProgress, signal) {
  let done = 0
  const total = files.length
  const poolSize = 4
  let idx = 0
  const workers = []
  const worker = async () => {
    while (idx < files.length) {
      if (signal && signal.aborted) throw util.cancelledError()
      const item = files[idx++]
      const url = item.url
      const dest = safeTarget(instanceDir, item.path || 'mods/' + path.basename(url))
      try {
        await util.download(url, dest, { onProgress, signal })
        if (item.sha1) {
          const actual = await util.sha1File(dest)
          if (actual !== item.sha1) throw new Error('sha1 mismatch')
        }
      } catch (e) {
        if (e.cancelled) throw e
        if (onProgress) onProgress({ phase: 'warn', message: `Mod ${path.basename(url)}: ${e.message}` })
      }
      done++
      if (onProgress) onProgress({ phase: 'mods', done, total, item: path.basename(url) })
    }
  }
  for (let i = 0; i < poolSize; i++) workers.push(worker())
  await Promise.all(workers)
  return done
}

function packName (zip) {
  try {
    const json = util.extractZipJson(zip, 'modrinth.index.json')
    if (json) return JSON.parse(json).name
  } catch {}
  try {
    const json = util.extractZipJson(zip, 'manifest.json')
    if (json) return JSON.parse(json).name
  } catch {}
  try {
    const cfg = util.extractZipEntry(zip, 'instance.cfg')
    if (cfg) return null
  } catch {}
  return path.basename(zip).replace(/\.(mrpack|zip)$/i, '')
}

function recommendedRam (file) {
  try {
    const cfg = util.extractZipEntry(file, 'instance.cfg')
    if (cfg) {
      const m = /(?:^|\n)\s*MaxMemory\s*=\s*(\d+)/i.exec(cfg)
      if (m && parseInt(m[1], 10) > 0) return parseInt(m[1], 10)
    }
  } catch {}
  return 0
}

function memoryFor (opts) {
  if (opts && opts.customMemory && opts.maxMemory) {
    return { maxMemory: opts.maxMemory, minMemory: (opts.minMemory || 512), customMemory: true }
  }
  return { customMemory: false }
}

/* ---------------- .mrpack ---------------- */

async function importMrpack (file, { name, downloadMods = true, includeOptional = false, onProgress, signal, ...opts } = {}) {
  const tmp = path.join(paths.cache(), 'import-' + Date.now())
  util.unzipTo(file, tmp)
  let inst = null
  try {
    const raw = fs.readFileSync(path.join(tmp, 'modrinth.index.json'), 'utf8')
    const index = JSON.parse(raw)
    const deps = index.dependencies || {}
    const mc = deps.minecraft
    const loader = deps['fabric-loader'] ? 'fabric'
      : deps['quilt-loader'] ? 'quilt'
        : deps.forge ? 'forge'
          : deps.neoforge ? 'neoforge' : 'vanilla'
    const loaderVersion = deps['fabric-loader'] || deps['quilt-loader'] || deps.forge || deps.neoforge || ''

    inst = instances.create(Object.assign({
      name: name || index.name || path.basename(file).replace(/\.mrpack$/i, ''),
      loader,
      mcVersion: mc,
      loaderVersion,
      source: 'import',
      icon: (opts && opts.icon) || ''
    }, memoryFor(opts)))
    if (onProgress) onProgress({ phase: 'loader', message: `Installing ${loader} for ${mc}` })
    const installed = await loaders.installLoader(loader, mc, loaderVersion || undefined, onProgress, signal)
    instances.update(inst.id, { versionId: installed.id })

    const files = (index.files || [])
      .filter(f => {
        const env = f.env || {}
        if (env.client === 'server') return false
        if (env.client === 'optional' && !includeOptional) return false
        return true
      })
      .map(f => ({
        url: (f.downloads && f.downloads[0]) || '',
        path: f.path || '',
        sha1: f.hashes && f.hashes.sha1
      }))
      .filter(f => f.url)
    if (downloadMods) {
      if (onProgress) onProgress({ phase: 'mods-start', message: 'Downloading ' + files.length + ' mods' })
      await downloadPackMods(files, paths.instanceDir(inst.id), onProgress, signal)
    }

    const overrides = path.join(tmp, 'overrides')
    if (fs.existsSync(overrides)) util.copyDir(overrides, paths.instanceDir(inst.id))

    return { instance: instances.get(inst.id), modsTotal: files.length }
  } catch (e) {
    if (e.cancelled && inst) { try { instances.remove(inst.id) } catch {} }
    throw e
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

/* ---------------- CurseForge zip ---------------- */

async function importCurseZip (file, { name, downloadMods = true, includeOptional = false, onProgress, signal, ...opts } = {}) {
  const tmp = path.join(paths.cache(), 'import-' + Date.now())
  util.unzipTo(file, tmp)
  let inst = null
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8'))
    const mc = manifest.minecraft && manifest.minecraft.version
    const loaderId = manifest.minecraft && manifest.minecraft.modLoaders && manifest.minecraft.modLoaders[0] && manifest.minecraft.modLoaders[0].id
    let loader = 'vanilla'
    let loaderVersion = ''
    if (loaderId) {
      const dash = loaderId.indexOf('-')
      if (dash !== -1) {
        loader = loaderId.slice(0, dash)
        loaderVersion = loaderId.slice(dash + 1)
        if (loader === 'fabric' && loaderVersion.startsWith('fabric-api')) loaderVersion = ''
      }
    }

    inst = instances.create(Object.assign({
      name: name || manifest.name || path.basename(file).replace(/\.zip$/i, ''),
      loader,
      mcVersion: mc,
      loaderVersion,
      source: 'import',
      icon: (opts && opts.icon) || ''
    }, memoryFor(opts)))
    if (onProgress) onProgress({ phase: 'loader', message: `Installing ${loader} for ${mc}` })
    const installed = await loaders.installLoader(loader, mc, loaderVersion || undefined, onProgress, signal)
    instances.update(inst.id, { versionId: installed.id })

    if (downloadMods) {
      const files = (manifest.files || []).filter(f => f.required !== false || includeOptional)
      const modsDir = path.join(paths.instanceDir(inst.id), 'mods')
      util.ensureDirSync(modsDir)
      let done = 0
      for (const f of files) {
        if (signal && signal.aborted) throw util.cancelledError()
        try {
          const res = await curseforge.downloadFile(f.projectID, f.fileID, modsDir, { onProgress, signal })
          if (onProgress) onProgress({ phase: 'mods-downloaded', item: res.filename })
        } catch (e) {
          if (e.cancelled) throw e
          if (onProgress) onProgress({ phase: 'warn', message: `Mod ${f.projectID}/${f.fileID}: ${e.message}` })
        }
        done++
        if (onProgress) onProgress({ phase: 'mods', done, total: files.length, item: String(f.projectID) })
      }
    }

    const overridesDir = manifest.overrides || 'overrides'
    const overrides = path.join(tmp, overridesDir)
    if (fs.existsSync(overrides)) util.copyDir(overrides, paths.instanceDir(inst.id))

    return { instance: instances.get(inst.id), modsTotal: (manifest.files || []).length }
  } catch (e) {
    if (e.cancelled && inst) { try { instances.remove(inst.id) } catch {} }
    throw e
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

/* ---------------- Prism / MultiMC zip ---------------- */

async function importPrismZip (file, { name, downloadMods = true, onProgress, signal, ...opts } = {}) {
  const tmp = path.join(paths.cache(), 'import-' + Date.now())
  util.unzipTo(file, tmp)
  let inst = null
  try {
    const pack = JSON.parse(fs.readFileSync(path.join(tmp, 'mmc-pack.json'), 'utf8'))
    const comps = pack.components || []
    const mcComp = comps.find(c => c.uid === 'net.minecraft')
    const mc = mcComp && mcComp.version
    const fComp = comps.find(c => c.uid === 'net.fabricmc.fabric-loader')
    const qComp = comps.find(c => c.uid === 'org.quiltmc.quilt-loader')
    const fgComp = comps.find(c => c.uid === 'net.minecraftforge')
    const nfComp = comps.find(c => c.uid === 'net.neoforged')
    let loader = 'vanilla'
    let loaderVersion = ''
    if (nfComp) { loader = 'neoforge'; loaderVersion = nfComp.version }
    else if (fgComp) { loader = 'forge'; loaderVersion = fgComp.version }
    else if (qComp) { loader = 'quilt'; loaderVersion = qComp.version }
    else if (fComp) { loader = 'fabric'; loaderVersion = fComp.version }

    inst = instances.create(Object.assign({
      name: name || pack.name || path.basename(file).replace(/\.zip$/i, ''),
      loader,
      mcVersion: mc,
      loaderVersion,
      source: 'import',
      icon: (opts && opts.icon) || ''
    }, memoryFor(opts)))
    if (onProgress) onProgress({ phase: 'loader', message: `Installing ${loader} for ${mc}` })
    const installed = await loaders.installLoader(loader, mc, loaderVersion || undefined, onProgress, signal)
    instances.update(inst.id, { versionId: installed.id })

    if (!(opts && opts.customMemory)) {
      try {
        const cfg = util.extractZipEntry(file, 'instance.cfg')
        const m = cfg && /(?:^|\n)\s*MaxMemory\s*=\s*(\d+)/i.exec(cfg)
        if (m && parseInt(m[1], 10) > 0) instances.update(inst.id, { maxMemory: parseInt(m[1], 10), minMemory: 512, customMemory: true })
      } catch {}
    }

    for (const entry of fs.readdirSync(tmp, { withFileTypes: true })) {
      if (entry.name === 'instance.cfg' || entry.name === 'mmc-pack.json') continue
      const s = path.join(tmp, entry.name)
      const d = path.join(paths.instanceDir(inst.id), entry.name)
      if (entry.isDirectory()) util.copyDir(s, d)
      else {
        util.ensureDirSync(path.dirname(d))
        fs.copyFileSync(s, d)
      }
    }

    return { instance: instances.get(inst.id), modsTotal: 0 }
  } catch (e) {
    if (e.cancelled && inst) { try { instances.remove(inst.id) } catch {} }
    throw e
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

/* ---------------- detection ---------------- */

async function detectPackType (file) {
  if (/\.mrpack$/i.test(file)) return 'mrpack'
  try {
    const mr = util.extractZipJson(file, 'modrinth.index.json')
    if (mr) return 'mrpack'
  } catch {}
  try {
    const cf = util.extractZipJson(file, 'manifest.json')
    if (cf) return 'curse'
  } catch {}
  try {
    const mmc = util.extractZipJson(file, 'mmc-pack.json')
    if (mmc) return 'prism'
  } catch {}
  throw new Error('Unrecognized modpack format')
}

async function importPack (file, opts) {
  const type = await detectPackType(file)
  switch (type) {
    case 'mrpack': return importMrpack(file, opts)
    case 'curse': return importCurseZip(file, opts)
    case 'prism': return importPrismZip(file, opts)
    default: throw new Error('Unsupported pack type')
  }
}

module.exports = {
  defaultDownloadDir, detectPackType, importPack, recommendedRam,
  importMrpack, importCurseZip, importPrismZip
}
