'use strict'
const path = require('path')
const os = require('os')
const fs = require('fs')
const { ensureDirSync } = require('./util')

let ROOT = null

function defaultRoot () {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'NightlyLauncher')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'NightlyLauncher')
  }
  return path.join(os.homedir(), '.nightly-launcher')
}

function init (root) {
  ROOT = root || defaultRoot()
  ensureDirSync(ROOT)
  ensureDirSync(path.join(ROOT, 'versions'))
  ensureDirSync(path.join(ROOT, 'versions', 'libraries'))
  ensureDirSync(path.join(ROOT, 'versions', 'assets'))
  ensureDirSync(path.join(ROOT, 'versions', 'assets', 'objects'))
  ensureDirSync(path.join(ROOT, 'versions', 'assets', 'indexes'))
  ensureDirSync(path.join(ROOT, 'instances'))
  ensureDirSync(path.join(ROOT, 'downloads'))
  ensureDirSync(path.join(ROOT, 'cache'))
  return ROOT
}

function root () { return ROOT || init() }
function versions () { return path.join(root(), 'versions') }
function libraries () { return path.join(versions(), 'libraries') }
function assets () { return path.join(versions(), 'assets') }
function assetsObjects () { return path.join(assets(), 'objects') }
function assetsIndexes () { return path.join(assets(), 'indexes') }
function versionDir (id) { return path.join(versions(), sanitizeId(id)) }
function instances () { return path.join(root(), 'instances') }
function instanceDir (id) { return path.join(instances(), sanitizeId(id)) }
function downloads () { return path.join(root(), 'downloads') }
function cache () { return path.join(root(), 'cache') }

function sanitizeId (id) {
  return String(id).replace(/[^A-Za-z0-9._\-]/g, '_')
}

function libraryPath (lib) {
  if (lib.downloads && lib.downloads.artifact && lib.downloads.artifact.path) {
    return path.join(libraries(), lib.downloads.artifact.path)
  }
  const name = typeof lib === 'string' ? lib : lib.name
  return path.join(libraries(), mavenNameToPath(name))
}

function mavenNameToPath (name) {
  const base = name.split('@')[0]
  const parts = base.split(':')
  const group = parts[0].replace(/\./g, '/')
  const artifact = parts[1]
  const version = parts[2]
  let classifier = ''
  if (parts.length > 3 && parts[3]) classifier = '-' + parts[3]
  return path.join(group, artifact, version, `${artifact}-${version}${classifier}.jar`)
}

module.exports = {
  init, root, versions, libraries, assets, assetsObjects, assetsIndexes,
  versionDir, instances, instanceDir, downloads, cache, sanitizeId, libraryPath, mavenNameToPath
}
