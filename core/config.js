'use strict'
const fs = require('fs')
const path = require('path')
const paths = require('./paths')

const DEFAULTS = {
  username: 'Player',
  javaPath: '',
  disableAutoJava: false,
  maxMemory: 4096,
  minMemory: 512,
  jvmArgs: '',
  gameArgs: '',
  resolution: { width: 854, height: 480 },
  fullscreen: false,
  downloadsLocation: paths.downloads(),
  curseforgeApiKey: '',
  filters: { releases: true, snapshots: false, betas: false, alphas: false, experiments: false },
  theme: 'midnight',
  onboarded: false,
  autoDownloadJava: true,
  warnInsufficientMemory: true,
  trackPlaytime: true,
  useGamemode: false,
  useMangohud: false,
  useDiscreteGpu: false
}

let cache = null

function configPath () {
  return path.join(paths.root(), 'config.json')
}

function load () {
  if (cache) return cache
  const p = configPath()
  let data = {}
  try {
    if (fs.existsSync(p)) data = JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch { data = {} }
  cache = Object.assign({}, DEFAULTS, data)
  return cache
}

function save (patch) {
  const cfg = load()
  Object.assign(cfg, patch || {})
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2))
  return cfg
}

module.exports = { load, save, DEFAULTS }
