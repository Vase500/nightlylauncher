'use strict'
const fs = require('fs')
const path = require('path')
const paths = require('./paths')
const util = require('./util')

function modsDir (instanceId) {
  return path.join(paths.instanceDir(instanceId), 'mods')
}

const META_FILE = '.mods-meta.json'

function metaPath (instanceId) {
  return path.join(modsDir(instanceId), META_FILE)
}

function readMeta (instanceId) {
  try {
    return JSON.parse(fs.readFileSync(metaPath(instanceId), 'utf8'))
  } catch {
    return {}
  }
}

function writeMeta (instanceId, meta) {
  try {
    const dir = modsDir(instanceId)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(metaPath(instanceId), JSON.stringify(meta, null, 2))
  } catch {}
}

function setMeta (instanceId, filename, meta) {
  const m = readMeta(instanceId)
  if (meta) m[filename] = meta
  else delete m[filename]
  writeMeta(instanceId, m)
}

function list (instanceId) {
  const dir = modsDir(instanceId)
  if (!fs.existsSync(dir)) return []
  const meta = readMeta(instanceId)
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && /\.jar$/i.test(e.name))
    .map(e => {
      const p = path.join(dir, e.name)
      const st = fs.statSync(p)
      return { filename: e.name, size: st.size, mtime: st.mtimeMs, meta: meta[e.name] || null }
    })
    .sort((a, b) => a.filename.localeCompare(b.filename))
}

function installCustom (instanceId, srcPath) {
  if (!srcPath) throw new Error('No file selected')
  const base = path.basename(srcPath)
  if (!/\.jar$/i.test(base)) throw new Error('Mod files must be .jar files')
  const dir = util.ensureDirSync(modsDir(instanceId))
  const dest = path.join(dir, util.sanitize(base))
  if (fs.existsSync(dest)) throw new Error('A mod named ' + base + ' is already installed')
  fs.copyFileSync(srcPath, dest)
  return { filename: path.basename(dest), size: fs.statSync(dest).size }
}

function installFromUrl (instanceId, url, filename, onProgress, signal) {
  const dir = util.ensureDirSync(modsDir(instanceId))
  const dest = path.join(dir, util.sanitize(filename || 'mod.jar'))
  if (fs.existsSync(dest)) throw new Error('A mod named ' + filename + ' is already installed')
  return util.download(url, dest, { onProgress, signal }).then(() => {
    return { filename: path.basename(dest), size: fs.statSync(dest).size }
  })
}

function remove (instanceId, filename) {
  const target = path.join(modsDir(instanceId), util.sanitize(filename || ''))
  if (!target.startsWith(modsDir(instanceId) + path.sep)) throw new Error('Invalid mod path')
  if (!fs.existsSync(target)) throw new Error('Mod not found: ' + filename)
  fs.unlinkSync(target)
  const meta = readMeta(instanceId)
  if (meta[filename]) {
    delete meta[filename]
    writeMeta(instanceId, meta)
  }
  return true
}

function openFolder (instanceId) {
  const dir = util.ensureDirSync(modsDir(instanceId))
  return dir
}

module.exports = { modsDir, list, installCustom, installFromUrl, remove, openFolder, readMeta, writeMeta, setMeta }
