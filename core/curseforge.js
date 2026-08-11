'use strict'
const fs = require('fs')
const path = require('path')
const { BrowserWindow } = require('electron')
const util = require('./util')

const SITE = 'https://www.curseforge.com'
const API = 'https://www.curseforge.com/api/v1'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

let win = null
let queue = Promise.resolve()
const idCache = new Map()

function sleep (ms) { return new Promise(r => setTimeout(r, ms)) }

function isNumeric (v) { return /^\d+$/.test(String(v)) }

function getWin () {
  if (win && !win.isDestroyed()) return win
  win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: false, nodeIntegration: false }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return win
}

function serial (fn) {
  const run = queue.then(fn, fn)
  queue = run.then(() => {}, () => {})
  return run
}

async function load (w, url, waitMs) {
  try { await w.loadURL(url, { userAgent: UA }) } catch {}
  if (waitMs) await sleep(waitMs)
}

async function pageText (w) {
  return w.webContents.executeJavaScript('document.body.textContent').catch(() => '')
}

const SCRAPE_SEARCH = `(() => {
  const out = []
  document.querySelectorAll('.project-card').forEach(c => {
    const link = c.querySelector('a.overlay-link')
    if (!link) return
    const href = link.getAttribute('href') || ''
    const slug = href.split('/').filter(Boolean).pop()
    const name = c.querySelector('a.name .ellipsis') || c.querySelector('a.name')
    const author = c.querySelector('.author-name') || c.querySelector('.author')
    const desc = c.querySelector('.description')
    const img = c.querySelector('.art img')
    const downloadsEl = c.querySelector('.detail-downloads')
    const updatedEl = c.querySelector('.detail-updated .date-full')
    const mcEl = c.querySelector('.detail-game-version')
    out.push({
      slug,
      name: name ? name.textContent.trim() : '',
      author: author ? (author.textContent || '').trim().replace(/^By\\s*/i, '') : '',
      summary: desc ? (desc.textContent || '').trim() : '',
      icon: img ? (img.getAttribute('src') || '') : '',
      downloads: downloadsEl ? (downloadsEl.textContent || '').replace(/\\s+/g, ' ').trim() : '',
      updated: updatedEl ? (updatedEl.textContent || '').trim() : '',
      mc: mcEl ? (mcEl.textContent || '').trim() : ''
    })
  })
  return out
})()`

const SCRAPE_MOD = `(() => {
  const title = document.title.replace(/\\s*-\\s*Minecraft.*$/i, '').trim()
  const icon = (document.querySelector('.project-icon img, .avatar img') || {}).src || ''
  const desc = (document.querySelector('.project-description, .description, .user-content') || {}).textContent || ''
  const downloads = (document.querySelector('[data-downloads], .project-downloads, .downloads') || {}).textContent || ''
  return { title, icon, summary: desc.replace(/\\s+/g, ' ').trim().slice(0, 500), downloads: downloads.replace(/\\s+/g, ' ').trim() }
})()`

function parseCount (s) {
  const m = String(s || '').match(/([\d.,]+)([KMGT]?)/i)
  if (!m) return 0
  const mult = { K: 1e3, M: 1e6, G: 1e9, T: 1e12 }[String(m[2]).toUpperCase()] || 1
  return Math.round(parseFloat(m[1].replace(/,/g, '')) * mult)
}

function parseDate (s) {
  const m = String(s || '').match(/([A-Z][a-z]{2}\s+\d{1,2},\s+(?:\d{4}))/)
  if (!m) return null
  const d = new Date(m[1])
  return isNaN(d.getTime()) ? null : d.toISOString()
}

function downloadUrlFor (modId, fileId) {
  if (isNumeric(modId)) return `${API}/mods/${modId}/files/${fileId}/download`
  return `${SITE}/minecraft/modpacks/${encodeURIComponent(modId)}/download/${fileId}`
}

async function resolveId (id) {
  if (isNumeric(id)) return String(id)
  if (idCache.has(id)) return idCache.get(id)
  const json = await util.request(`https://api.cfwidget.com/minecraft/modpacks/${encodeURIComponent(id)}`, { json: true })
  if (!json || !json.id) throw new Error('Could not resolve CurseForge project: ' + id)
  idCache.set(id, String(json.id))
  return String(json.id)
}

async function search ({ query = '', index = 0, pageSize = 20, cfg, type = 'modpacks' } = {}) {
  return serial(async () => {
    const page = Math.max(1, Math.floor(index / Math.max(1, pageSize)) + 1)
    const url = `${SITE}/minecraft/search?class=${encodeURIComponent(type)}&search=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`
    const w = getWin()
    let raw = []
    for (let attempt = 0; attempt < 3 && !raw.length; attempt++) {
      await load(w, url, 2400 + attempt * 900)
      let txt = ''
      try { txt = await pageText(w) } catch {}
      if (/Just a moment|Attention Required/i.test(txt)) continue
      try { raw = await w.webContents.executeJavaScript(SCRAPE_SEARCH) } catch {}
    }
    if (!raw.length) throw new Error('CurseForge did not return any results. Try again in a moment.')
    return raw.map(r => ({
      id: r.slug,
      slug: r.slug,
      name: r.name || r.slug,
      summary: r.summary,
      author: r.author,
      downloads: parseCount(r.downloads),
      updated: parseDate(r.updated),
      mc: r.mc,
      icon: r.icon || ''
    }))
  })
}

async function getMod (modId, cfg) {
  return serial(async () => {
    if (isNumeric(modId)) throw new Error('CurseForge project lookup by numeric ID is unavailable')
    const w = getWin()
    await load(w, `${SITE}/minecraft/modpacks/${encodeURIComponent(modId)}`, 3000)
    let m = null
    try { m = await w.webContents.executeJavaScript(SCRAPE_MOD) } catch {}
    if (!m || !m.title) throw new Error('Could not load CurseForge project')
    return {
      id: modId,
      slug: modId,
      name: m.title,
      summary: m.summary,
      author: '',
      downloads: parseCount(m.downloads),
      updated: null,
      icon: m.icon
    }
  })
}

async function getFiles (modId, opts = {}) {
  return serial(async () => {
    const id = await resolveId(modId)
    const pageSize = opts.pageSize || 50
    const maxPages = opts.maxPages || 1
    const out = []
    for (let page = 0; page < maxPages; page++) {
      const qs = new URLSearchParams({ pageSize: String(pageSize), index: String(page * pageSize) })
      if (opts.gameVersion) qs.set('gameVersion', String(opts.gameVersion))
      const w = getWin()
      let data = null
      for (let attempt = 0; attempt < 3 && !data; attempt++) {
        await load(w, `${API}/mods/${id}/files?${qs}`, 2000)
        const txt = await pageText(w)
        try { data = JSON.parse(txt) } catch {}
      }
      if (!data || !Array.isArray(data.data)) throw new Error('Could not load CurseForge files')
      if (!data.data.length) break
      out.push(...data.data)
      if (data.data.length < pageSize) break
    }
    return out.map(f => ({
      id: f.id,
      displayName: f.displayName || f.fileName,
      fileName: f.fileName,
      fileLength: f.fileLength,
      releaseType: f.releaseType,
      gameVersions: f.gameVersions || [],
      downloadUrl: ''
    }))
  })
}

async function getDownloadUrl (modId, fileId, cfg) {
  return serial(async () => {
    const w = getWin()
    const url = downloadUrlFor(modId, fileId)
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => { cleanup(); reject(new Error('Could not resolve CurseForge download URL')) }, 30000)
      const onUrl = u => { clearTimeout(to); cleanup(); resolve(u) }
      const onRedir = (e, u) => {
        if (/forgecdn|mediafilez|\.zip|\.jar|\.mrpack/i.test(u)) onUrl(u)
      }
      const onDownload = (e, item) => { onUrl(item.getURL()); try { item.cancel() } catch {} }
      const cleanup = () => {
        w.webContents.removeListener('will-redirect', onRedir)
        w.webContents.session.removeListener('will-download', onDownload)
      }
      w.webContents.on('will-redirect', onRedir)
      w.webContents.session.on('will-download', onDownload)
      w.loadURL(url, { userAgent: UA }).catch(() => {})
    })
  })
}

async function downloadFile (modId, fileId, dir, onProgressOrOpts) {
  const opts = typeof onProgressOrOpts === 'function' ? { onProgress: onProgressOrOpts } : (onProgressOrOpts || {})
  const { onProgress, signal } = opts
  return serial(async () => {
    const w = getWin()
    fs.mkdirSync(dir, { recursive: true })
    const url = downloadUrlFor(modId, fileId)
    return new Promise((resolve, reject) => {
      let itemRef = null
      let cancelled = false
      const onAbort = () => {
        cancelled = true
        try { if (itemRef && itemRef.cancel) itemRef.cancel() } catch {}
      }
      if (signal) {
        if (signal.aborted) { onAbort(); reject(util.cancelledError()); return }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      const to = setTimeout(() => { cleanup(); reject(new Error('Download timed out')) }, 600000)
      const onDownload = (e, item) => {
        itemRef = item
        const name = String(item.getFilename() || `file-${fileId}.bin`).replace(/[\\/:*?"<>|]/g, '_')
        const dest = path.join(dir, name)
        item.setSavePath(dest)
        if (onProgress) {
          item.on('updated', (ev, st) => {
            if (st.state === 'progressing') onProgress({ phase: 'download', received: st.receivedBytes, total: st.totalBytes, percent: st.percent })
          })
        }
        item.once('done', (ev, st) => {
          clearTimeout(to)
          cleanup()
          if (cancelled) {
            try { fs.rmSync(dest, { force: true }) } catch {}
            reject(util.cancelledError())
          } else if (st.state === 'completed') resolve({ path: dest, filename: name, size: item.getTotalBytes() })
          else if (st.state === 'interrupted') reject(new Error('Download interrupted'))
          else reject(new Error('Download failed'))
        })
      }
      const cleanup = () => {
        w.webContents.session.removeListener('will-download', onDownload)
        if (signal) signal.removeEventListener('abort', onAbort)
      }
      w.webContents.session.on('will-download', onDownload)
      w.loadURL(url, { userAgent: UA }).catch(() => {})
    })
  })
}

module.exports = { search, getMod, getFiles, getDownloadUrl, downloadFile, LOADER_MAP: {} }
