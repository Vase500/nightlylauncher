'use strict'
const fs = require('fs')
const path = require('path')
const paths = require('./paths')
const util = require('./util')

let cache = null

function dbFile () {
  return path.join(paths.root(), 'instances.json')
}

function load () {
  if (cache) return cache
  try {
    if (fs.existsSync(dbFile())) cache = JSON.parse(fs.readFileSync(dbFile(), 'utf8'))
  } catch {}
  if (!Array.isArray(cache)) cache = []
  return cache
}

function save () {
  fs.writeFileSync(dbFile(), JSON.stringify(cache, null, 2))
}

function list () {
  return load()
}

function get (id) {
  return load().find(i => i.id === id)
}

function create (data) {
  const db = load()
  const id = util.sanitize((data.id || data.name || 'instance') + '-' + Math.random().toString(36).slice(2, 7))
  const inst = Object.assign({
    id,
    name: 'New Instance',
    loader: 'vanilla',
    mcVersion: '',
    loaderVersion: '',
    versionId: '',
    javaPath: '',
    maxMemory: 0,
    minMemory: 0,
    customMemory: false,
    jvmArgs: '',
    gameArgs: '',
    resolution: { width: 854, height: 480 },
    fullscreen: false,
    icon: '',
    notes: '',
    source: 'custom',
    packInfo: null,
    createdAt: Date.now(),
    lastPlayed: 0,
    playtimeMs: 0
  }, data, { id })
  db.push(inst)
  save()
  return inst
}

function update (id, patch) {
  const db = load()
  const idx = db.findIndex(i => i.id === id)
  if (idx === -1) throw new Error('Instance not found: ' + id)
  db[idx] = Object.assign({}, db[idx], patch, { id })
  save()
  return db[idx]
}

function remove (id) {
  const db = load()
  const idx = db.findIndex(i => i.id === id)
  if (idx !== -1) {
    db.splice(idx, 1)
    save()
  }
  try { fs.rmSync(paths.instanceDir(id), { recursive: true, force: true }) } catch {}
  return true
}

function gameDir (id) {
  return paths.instanceDir(id)
}

function dup (id) {
  const inst = get(id)
  if (!inst) throw new Error('Instance not found: ' + id)
  const copy = create(Object.assign({}, inst, {
    name: inst.name + ' (copy)',
    id: undefined,
    createdAt: Date.now(),
    lastPlayed: 0
  }))
  const srcDir = gameDir(id)
  if (fs.existsSync(srcDir)) util.copyDir(srcDir, gameDir(copy.id))
  return copy
}

module.exports = { list, get, create, update, remove, gameDir, dup }
