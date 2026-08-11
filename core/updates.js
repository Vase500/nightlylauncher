'use strict'
const path = require('path')
const fs = require('fs')
const util = require('./util')

const OWNER = 'Vase500'
const REPO = 'nightlylauncher'
const API = `https://api.github.com/repos/${OWNER}/${REPO}`

function normalizeVersion (v) {
  const s = String(v || '').trim().replace(/^v/i, '')
  const m = s.match(/^\d+\.\d+(?:\.\d+)*/)
  return m ? m[0] : ''
}

function versionParts (s) {
  return String(s || '').split('.').map(p => parseInt(p, 10) || 0)
}

function compareVersions (a, b) {
  const pa = versionParts(normalizeVersion(a))
  const pb = versionParts(normalizeVersion(b))
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

function githubHeaders () {
  return { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
}

async function github (url) {
  return util.getJson(url, githubHeaders())
}

const LINUX_PREFERENCE = {
  arch: ['pacman', 'appimage', 'deb', 'rpm'],
  debian: ['deb', 'appimage', 'rpm', 'pacman'],
  rpm: ['rpm', 'appimage', 'deb', 'pacman'],
  other: ['appimage', 'deb', 'rpm', 'pacman']
}

function pkgKind (name) {
  const n = String(name || '').toLowerCase()
  if (n.endsWith('.exe')) return 'exe'
  if (n.endsWith('.dmg')) return 'dmg'
  if (n.endsWith('.appimage')) return 'appimage'
  if (n.endsWith('.deb')) return 'deb'
  if (n.endsWith('.rpm')) return 'rpm'
  if (n.endsWith('.pkg.tar.zst') || n.endsWith('.pacman')) return 'pacman'
  return null
}

function detectLinux () {
  if (process.platform !== 'linux') return null
  let osrelease = ''
  try { osrelease = fs.readFileSync('/etc/os-release', 'utf8') } catch {}
  const read = m => String((osrelease.match(m) || [])[1] || '').replace(/["']/g, '').trim().toLowerCase()
  const id = read(/^ID=(.*)$/m)
  const idLike = read(/^ID_LIKE=(.*)$/m)
  const all = id + ' ' + idLike
  if (all.includes('arch')) return { family: 'arch' }
  if (all.includes('debian') || all.includes('ubuntu') || all.includes('mint') || all.includes('elementary')) return { family: 'debian' }
  if (all.includes('fedora') || all.includes('rhel') || all.includes('centos') || all.includes('opensuse') || all.includes('suse')) return { family: 'rpm' }
  return { family: 'other' }
}

function platformAsset (assets) {
  const list = assets || []
  if (process.platform === 'win32') {
    const a = list.find(x => pkgKind(x.name) === 'exe' && /setup/i.test(x.name)) || list.find(x => pkgKind(x.name) === 'exe')
    return a ? { name: a.name, url: a.browser_download_url, size: a.size } : null
  }
  if (process.platform === 'darwin') {
    const a = list.find(x => pkgKind(x.name) === 'dmg')
    return a ? { name: a.name, url: a.browser_download_url, size: a.size } : null
  }
  const fam = (detectLinux() || { family: 'other' }).family
  for (const kind of LINUX_PREFERENCE[fam] || LINUX_PREFERENCE.other) {
    const a = list.find(x => pkgKind(x.name) === kind)
    if (a) return { name: a.name, url: a.browser_download_url, size: a.size }
  }
  return null
}

function installCommand (pkgPath) {
  if (process.platform !== 'linux' || !pkgPath) return null
  const has = b => { try { fs.accessSync('/usr/bin/' + b); return true } catch { return false } }
  const kind = pkgKind(pkgPath)
  if (kind === 'pacman') return has('pkexec') ? { label: 'pacman', cmd: '/usr/bin/pkexec', args: ['/usr/bin/pacman', '-U', '--noconfirm', pkgPath] } : null
  if (kind === 'deb') {
    if (!has('pkexec')) return null
    if (has('apt-get')) return { label: 'apt', cmd: '/usr/bin/pkexec', args: ['/usr/bin/apt-get', 'install', '-y', pkgPath] }
    return { label: 'dpkg', cmd: '/usr/bin/pkexec', args: ['/usr/bin/dpkg', '-i', pkgPath] }
  }
  if (kind === 'rpm') {
    if (!has('pkexec')) return null
    if (has('dnf')) return { label: 'dnf', cmd: '/usr/bin/pkexec', args: ['/usr/bin/dnf', 'install', '-y', pkgPath] }
    if (has('zypper')) return { label: 'zypper', cmd: '/usr/bin/pkexec', args: ['/usr/bin/zypper', 'install', '-y', pkgPath] }
    return { label: 'rpm', cmd: '/usr/bin/pkexec', args: ['/usr/bin/rpm', '-Uvh', pkgPath] }
  }
  return null
}

async function ensureExecutable (pkgPath) {
  if (process.platform !== 'linux' || pkgKind(pkgPath) !== 'appimage') return
  try { fs.chmodSync(pkgPath, 0o755) } catch {}
}

function releaseAssets (tag) {
  return github(`${API}/releases/tags/${tag}`).then(rel => platformAsset(rel.assets)).catch(() => null)
}

async function check (current) {
  current = current || '0.0.0'
  let latest = null
  let downloadUrl = null
  let downloadName = null
  let downloadSize = 0
  let source = null

  try {
    const rel = await github(`${API}/releases/latest`)
    const tag = normalizeVersion(rel.tag_name)
    if (tag) {
      latest = tag
      source = 'release'
      const a = platformAsset(rel.assets)
      if (a) { downloadUrl = a.url; downloadName = a.name; downloadSize = a.size }
    }
  } catch {}

  if (!latest) {
    try {
      const repo = await github(API)
      const branch = repo.default_branch || 'main'
      const pkg = await util.getJson(`https://raw.githubusercontent.com/${OWNER}/${REPO}/${branch}/package.json`)
      const v = normalizeVersion(pkg.version)
      if (v) {
        latest = v
        source = 'source'
        const a = await releaseAssets('v' + v) || await releaseAssets(v)
        if (a) { downloadUrl = a.url; downloadName = a.name; downloadSize = a.size }
      }
    } catch {}
  }

  if (!latest) {
    try {
      const tags = await github(`${API}/tags`)
      const cands = (tags || []).map(t => normalizeVersion(t.name)).filter(Boolean)
      if (cands.length) {
        cands.sort(compareVersions)
        latest = cands[cands.length - 1]
        source = 'tag'
        const a = await releaseAssets('v' + latest) || await releaseAssets(latest)
        if (a) { downloadUrl = a.url; downloadName = a.name; downloadSize = a.size }
      }
    } catch {}
  }

  const hasUpdate = !!latest && compareVersions(latest, current) > 0
  return { current, latest, hasUpdate, downloadUrl, downloadName, downloadSize, source }
}

async function download (info, onProgress) {
  if (!info || !info.downloadUrl) {
    const e = new Error('No download available for this update')
    e.noAsset = true
    throw e
  }
  const cfg = require('./config').load()
  const destDir = cfg.downloadsLocation || require('./paths').downloads()
  const name = info.downloadName || `NightlyLauncher-${util.sanitize(info.latest || 'update')}`
  const dest = path.join(destDir, util.sanitize(name))
  const res = await util.download(info.downloadUrl, dest, {
    headers: { Accept: 'application/octet-stream' },
    onProgress
  })
  await ensureExecutable(res.dest)
  return { path: res.dest, bytes: res.bytes, name }
}

module.exports = { check, download, installCommand, detectLinux, compareVersions, normalizeVersion }
