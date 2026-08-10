'use strict'
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
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

/* ---------- jar metadata extraction (offline, no dependencies) ---------- */

function listZipEntries (buf) {
  const out = new Map()
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) return out
  const count = buf.readUInt16LE(eocd + 10)
  if (!count) return out
  const cdOff = buf.readUInt32LE(eocd + 16)
  let p = cdOff
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length) break
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (!name.endsWith('/')) out.set(name, { off: localOff, method, compSize })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

function readZipEntry (buf, entries, name) {
  const e = entries.get(name)
  if (!e) return null
  const lh = e.off
  if (lh + 30 > buf.length) return null
  if (buf.readUInt32LE(lh) !== 0x04034b50) return null
  const nameLen = buf.readUInt16LE(lh + 26)
  const extraLen = buf.readUInt16LE(lh + 28)
  const start = lh + 30 + nameLen + extraLen
  const chunk = buf.slice(start, start + e.compSize)
  try {
    if (e.method === 0) return chunk
    if (e.method === 8) return zlib.inflateRawSync(chunk)
  } catch {}
  return null
}

function parseJson (buf) {
  if (!buf) return null
  try { return JSON.parse(buf.toString('utf8')) } catch { return null }
}

function parseTomlValue (v) {
  v = String(v).trim()
  if (/^"[^"]*"$/.test(v) && !v.includes('\n')) {
    return v.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  if (/^'[^']*'$/.test(v) && !v.includes('\n')) return v.slice(1, -1)
  if (v === 'true') return true
  if (v === 'false') return false
  if (v.startsWith('[') && v.endsWith(']')) {
    return v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean).map(parseTomlValue)
  }
  if (/^[\d.+-]+$/.test(v)) {
    const n = parseFloat(v)
    if (!isNaN(n)) return n
  }
  return v
}

function parseToml (src) {
  const root = {}
  let cur = root
  const lines = String(src || '').split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    let line = lines[i].trim()
    i++
    if (!line || line.startsWith('#')) continue
    let m = line.match(/^\[\[(.+)\]\]$/)
    if (m) {
      const parts = m[1].split('.').map(s => s.trim())
      let o = root
      for (const p of parts.slice(0, -1)) {
        if (!o[p] || typeof o[p] !== 'object') o[p] = {}
        o = o[p]
      }
      const last = parts[parts.length - 1]
      if (!Array.isArray(o[last])) o[last] = []
      const obj = {}
      o[last].push(obj)
      cur = obj
      continue
    }
    m = line.match(/^\[(.+)\]$/)
    if (m) {
      const parts = m[1].split('.').map(s => s.trim())
      let o = root
      for (const p of parts) {
        if (!o[p] || typeof o[p] !== 'object') o[p] = {}
        o = o[p]
      }
      cur = o
      continue
    }
    m = line.match(/^([^=]+)=(.*)$/)
    if (!m) continue
    const key = m[1].trim()
    let val = m[2].trim()
    if (/^"""|^'''/.test(val)) {
      const delim = val.slice(0, 3)
      let body = val.slice(3)
      if (body.endsWith(delim)) {
        val = body.slice(0, -3)
      } else {
        while (i < lines.length) {
          const l = lines[i]
          i++
          const ci = l.indexOf(delim)
          if (ci >= 0) { body += '\n' + l.slice(0, ci); break }
          body += '\n' + l
        }
        val = body
      }
      cur[key] = val.trim()
      continue
    }
    cur[key] = parseTomlValue(val)
  }
  return root
}

function parseManifest (buf) {
  if (!buf) return {}
  const out = {}
  let key = null
  let val = ''
  for (const raw of buf.toString('utf8').split(/\r?\n/)) {
    const line = raw
    if (!line.trim()) continue
    if (line.startsWith(' ')) {
      val += line.slice(1)
      if (key) out[key] = val
      continue
    }
    const idx = line.indexOf(':')
    if (idx < 0) continue
    key = line.slice(0, idx)
    val = line.slice(idx + 1).trim()
    out[key] = val
  }
  return out
}

function toDataUrl (buf) {
  if (!buf || !buf.length) return ''
  const mime = (buf[0] === 0xff && buf[1] === 0xd8) ? 'image/jpeg'
    : (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) ? 'image/gif'
      : 'image/png'
  return 'data:' + mime + ';base64,' + buf.toString('base64')
}

function readJarMeta (jarPath) {
  let buf
  try { buf = fs.readFileSync(jarPath) } catch { return null }
  const entries = listZipEntries(buf)
  if (!entries.size) return null
  const read = n => readZipEntry(buf, entries, n)
  const meta = {}

  const quilt = parseJson(read('quilt.mod.json'))
  const fabric = parseJson(read('fabric.mod.json'))
  const neoforge = parseToml(read('META-INF/neoforge.mods.toml'))
  const forge = parseToml(read('META-INF/mods.toml'))
  const mcmod = parseJson(read('mcmod.info'))

  if (quilt && quilt.quilt_loader && quilt.quilt_loader.id) {
    const q = quilt.quilt_loader
    meta.source = 'quilt'
    meta.id = q.id
    meta.name = (q.metadata && q.metadata.name) || q.id
    meta.version = q.version || ''
    meta.description = (q.metadata && typeof q.metadata.description === 'string') ? q.metadata.description : ''
    const ic = q.metadata && q.metadata.icon
    meta.iconPath = typeof ic === 'string' ? ic : null
  } else if (fabric && fabric.id) {
    meta.source = 'fabric'
    meta.id = fabric.id
    meta.name = fabric.name || fabric.id
    meta.version = fabric.version || ''
    meta.description = typeof fabric.description === 'string' ? fabric.description : (fabric.description && fabric.description.text) || ''
    meta.iconPath = typeof fabric.icon === 'string' ? fabric.icon : null
  } else if (neoforge.mods && neoforge.mods.length) {
    const m0 = neoforge.mods[0]
    meta.source = 'neoforge'
    meta.id = m0.modId || ''
    meta.name = m0.displayName || m0.modId || ''
    meta.version = m0.version || ''
    meta.description = m0.description || ''
    meta.iconPath = m0.logoFile || null
  } else if (forge.mods && forge.mods.length) {
    const m0 = forge.mods[0]
    meta.source = 'forge'
    meta.id = m0.modId || ''
    meta.name = m0.displayName || m0.modId || ''
    meta.version = m0.version || ''
    meta.description = m0.description || ''
    meta.iconPath = m0.logoFile || null
  } else if (mcmod && mcmod[0] && mcmod[0].modid) {
    const m0 = mcmod[0]
    meta.source = 'mcmodinfo'
    meta.id = m0.modid
    meta.name = m0.name || m0.modid
    meta.version = m0.version || ''
    meta.description = m0.description || ''
    meta.iconPath = m0.logoFile || null
  } else {
    const manifest = parseManifest(read('META-INF/MANIFEST.MF'))
    if (manifest['Implementation-Title'] || manifest['Automatic-Module-Name']) {
      meta.source = 'manifest'
      meta.id = manifest['Automatic-Module-Name'] || ''
      meta.name = manifest['Implementation-Title'] || ''
      meta.version = manifest['Implementation-Version'] || ''
      meta.description = ''
      meta.iconPath = null
    } else {
      return null
    }
  }

  if (!meta.name && !meta.id) return null

  let iconBuf = meta.iconPath ? read(meta.iconPath.replace(/^\/+/, '')) : null
  if (!iconBuf && meta.id) iconBuf = read('assets/' + meta.id + '/icon.png')
  if (iconBuf) meta.icon = toDataUrl(iconBuf)
  delete meta.iconPath
  return meta
}

module.exports = { modsDir, list, installCustom, installFromUrl, remove, openFolder, readMeta, writeMeta, setMeta, readJarMeta }
