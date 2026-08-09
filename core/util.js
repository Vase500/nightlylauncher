'use strict'
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')
const http = require('http')
const https = require('https')
const os = require('os')
const zlib = require('zlib')
const { execFileSync } = require('child_process')

const UA = 'nightly-launcher/1.0'

function sleep (ms) { return new Promise(r => setTimeout(r, ms)) }

async function ensureDir (dir) { await fsp.mkdir(dir, { recursive: true }); return dir }
function ensureDirSync (dir) { fs.mkdirSync(dir, { recursive: true }); return dir }

function exists (p) {
  try { fs.accessSync(p); return true } catch { return false }
}

function sha1Hex (data) { return crypto.createHash('sha1').update(data).digest('hex') }

async function sha1File (p) { return sha1Hex(await fsp.readFile(p)) }

function cancelledError (msg) {
  const e = new Error(msg || 'Download cancelled')
  e.cancelled = true
  return e
}

function request (url, { method = 'GET', headers = {}, redirects = 10, json = false, body = null, signal } = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http
    const req = mod.request(url, { method, headers: Object.assign({ 'User-Agent': UA }, headers) }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume()
        let next = res.headers.location
        if (next.startsWith('/')) {
          const u = new URL(url)
          next = u.origin + next
        }
        request(next, { method, headers, redirects: redirects - 1, json, body, signal }).then(resolve, reject)
        return
      }
      const chunks = []
      const onAbort = () => res.destroy(cancelledError())
      if (signal) {
        if (signal.aborted) { onAbort(); return }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        if (signal) signal.removeEventListener('abort', onAbort)
        const raw = Buffer.concat(chunks)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          if (json) {
            try { resolve(JSON.parse(raw.toString('utf8'))) }
            catch (e) { reject(new Error('Invalid JSON from ' + url)) }
          } else resolve({ status: res.statusCode, body: raw, headers: res.headers })
        } else {
          const err = new Error(`HTTP ${res.statusCode} ${url}`)
          err.status = res.statusCode
          err.body = raw
          reject(err)
        }
      })
      res.on('error', err => {
        if (signal) signal.removeEventListener('abort', onAbort)
        if (err && err.cancelled) reject(err)
        else if (err && err.code === 'ERR_STREAM_PREMATURE_CLOSE' && signal && signal.aborted) reject(cancelledError())
        else reject(err)
      })
    })
    const onReqAbort = () => req.destroy(cancelledError())
    if (signal) {
      if (signal.aborted) { onReqAbort(); return }
      signal.addEventListener('abort', onReqAbort, { once: true })
    }
    req.on('close', () => { if (signal) signal.removeEventListener('abort', onReqAbort) })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function postForm (url, form, headers) {
  const body = Object.entries(form || {})
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&')
  return request(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, headers),
    body,
    json: true
  })
}

async function postJson (url, obj, headers) {
  return request(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, headers),
    body: JSON.stringify(obj),
    json: true
  })
}

async function getBuffer (url, headers) {
  const res = await request(url, { headers })
  return res.body
}

async function getJson (url, headers) {
  const body = await getBuffer(url, headers)
  return JSON.parse(body.toString('utf8'))
}

async function download (url, dest, { headers = {}, onProgress, signal } = {}) {
  await ensureDir(path.dirname(dest))
  const res = await request(url, { headers, signal })
  const tmp = dest + '.part'
  try {
    await fsp.writeFile(tmp, res.body)
    fs.renameSync(tmp, dest)
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }) } catch {}
    try { fs.rmSync(dest, { force: true }) } catch {}
    throw e
  }
  if (onProgress) onProgress({ received: res.body.length, total: res.body.length, dest, url })
  return { bytes: res.body.length, dest }
}

function unzipTo (src, dest) {
  ensureDirSync(dest)
  if (os.platform() === 'win32') {
    const tmp = ensureDirSync(path.join(os.tmpdir(), 'nightly-unzip-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)))
    const ps = require('child_process').spawnSync('powershell.exe', ['-NoProfile', '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${src}', '${tmp}')`], { stdio: 'pipe' })
    if (ps.status !== 0) {
      fs.rmSync(tmp, { recursive: true, force: true })
      throw new Error(`unzip failed: ${(ps.stderr || '').toString()}`)
    }
    for (const entry of fs.readdirSync(tmp, { withFileTypes: true })) {
      const s = path.join(tmp, entry.name)
      const d = path.join(dest, entry.name)
      if (entry.isDirectory()) copyDir(s, d)
      else {
        ensureDirSync(path.dirname(d))
        fs.copyFileSync(s, d)
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true })
  } else {
    zipExtractAll(src, dest)
  }
}

function zipEntries (buf) {
  let eocd = -1
  const min = Math.max(0, buf.length - 22 - 65536)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a zip archive')
  const count = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (cdOffset + cdSize > buf.length) throw new Error('corrupt zip archive')
  const entries = []
  let off = cdOffset
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('corrupt zip central directory')
    entries.push({
      method: buf.readUInt16LE(off + 10),
      flags: buf.readUInt16LE(off + 8),
      compSize: buf.readUInt32LE(off + 20),
      name: buf.toString('utf8', off + 46, off + 46 + buf.readUInt16LE(off + 28)),
      external: buf.readUInt32LE(off + 38),
      localOff: buf.readUInt32LE(off + 42)
    })
    off += 46 + buf.readUInt16LE(off + 28) + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32)
  }
  return entries
}

function zipReadEntry (buf, entry) {
  const lo = entry.localOff
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('corrupt zip local header')
  const flags = buf.readUInt16LE(lo + 6)
  const nameLen = buf.readUInt16LE(lo + 26)
  const extraLen = buf.readUInt16LE(lo + 28)
  const dataStart = lo + 30 + nameLen + extraLen
  if (flags & 0x1) throw new Error('encrypted zip entries not supported')
  const comp = buf.subarray(dataStart, dataStart + entry.compSize)
  if (entry.method === 0) return comp
  if (entry.method === 8) return zlib.inflateRawSync(comp)
  throw new Error('unsupported zip compression method ' + entry.method)
}

function zipExtractAll (src, dest) {
  const buf = fs.readFileSync(src)
  for (const e of zipEntries(buf)) {
    if (e.name.endsWith('/') || e.name.endsWith('\\')) continue
    const parts = e.name.split(/[\\/]/)
    if (parts.some(p => p === '..' || p === '.' || !p)) continue
    const target = path.join(dest, ...parts)
    ensureDirSync(path.dirname(target))
    fs.writeFileSync(target, zipReadEntry(buf, e))
    if (os.platform() !== 'win32' && ((e.external >>> 16) & 0xFFFF) & 0o111) {
      try { fs.chmodSync(target, 0o755) } catch {}
    }
  }
}

function zipFindEntry (src, entryName) {
  const buf = fs.readFileSync(src)
  const norm = entryName.replace(/\\/g, '/')
  const e = zipEntries(buf).find(en => en.name.replace(/\\/g, '/') === norm)
  if (!e) return { found: false }
  return { found: true, buf, entry: e }
}

function extractZipEntry (src, entryName, destPath) {
  const tmp = ensureDirSync(path.join(os.tmpdir(), 'nightly-entry-' + Date.now()))
  try {
    if (os.platform() === 'win32') {
      const ps = require('child_process').spawnSync('powershell.exe', ['-NoProfile', '-Command',
        `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::OpenRead('${src}'); $e=$z.Entries | Where-Object { $_.FullName -eq '${entryName}' } | Select-Object -First 1; if($e){ $out='${destPath}'; New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null; [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e,$out,$true) }; $z.Dispose()`], { stdio: 'pipe' })
      if (ps.status !== 0) throw new Error(`extract failed: ${(ps.stderr || '').toString()}`)
    } else {
      const found = zipFindEntry(src, entryName)
      if (found.found) {
        ensureDirSync(path.dirname(destPath))
        fs.writeFileSync(destPath, zipReadEntry(found.buf, found.entry))
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

function extractZipJson (src, entryName) {
  const tmp = ensureDirSync(path.join(os.tmpdir(), 'nightly-entry-' + Date.now()))
  try {
    if (os.platform() === 'win32') {
      const ps = require('child_process').spawnSync('powershell.exe', ['-NoProfile', '-Command',
        `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::OpenRead('${src}'); $e=$z.Entries | Where-Object { $_.FullName -eq '${entryName}' } | Select-Object -First 1; if($e){ $sr=New-Object System.IO.StreamReader($e.Open()); $t=$sr.ReadToEnd(); $sr.Close() }; $z.Dispose(); if($t){ Write-Output $t }`], { stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 64 })
      if (ps.status !== 0) throw new Error(`extract failed`)
      return ps.stdout ? ps.stdout.toString('utf8').trim() : null
    }
    const found = zipFindEntry(src, entryName)
    if (!found.found) return null
    return zipReadEntry(found.buf, found.entry).toString('utf8')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

function copyDir (src, dest) {
  ensureDirSync(dest)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

function walk (dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

function sanitize (name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120)
}

function formatBytes (n) {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return v.toFixed(i === 0 ? 0 : 1) + ' ' + units[i]
}

function osName () {
  return os.platform() === 'win32' ? 'windows' : os.platform() === 'darwin' ? 'osx' : 'linux'
}

function archName () {
  const a = process.arch
  return a === 'x64' ? '64' : a === 'ia32' ? '32' : a === 'arm64' ? 'arm64' : '64'
}

module.exports = {
  sleep, ensureDir, ensureDirSync, exists, sha1Hex, sha1File, getBuffer, getJson,
  download, request, postForm, postJson, unzipTo, extractZipEntry, extractZipJson, copyDir, walk,
  sanitize, formatBytes, osName, archName, cancelledError
}
