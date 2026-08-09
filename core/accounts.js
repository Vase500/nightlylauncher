'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const paths = require('./paths')
const auth = require('./auth')

let cache = null

function filePath () {
  return path.join(paths.root(), 'accounts.json')
}

function load () {
  if (cache) return cache
  let data = { accounts: [], selectedId: null }
  try {
    if (fs.existsSync(filePath())) data = JSON.parse(fs.readFileSync(filePath(), 'utf8'))
  } catch {}
  if (!Array.isArray(data.accounts)) data.accounts = []
  cache = data
  return cache
}

function save () {
  fs.writeFileSync(filePath(), JSON.stringify(cache, null, 2))
}

function list () {
  return load().accounts
}

function get (id) {
  return load().accounts.find(a => a.id === id) || null
}

function selected () {
  const d = load()
  return d.accounts.find(a => a.id === d.selectedId) || null
}

function setSelected (id) {
  const d = load()
  if (!d.accounts.find(a => a.id === id)) return false
  d.selectedId = id
  save()
  return true
}

function addOffline (username) {
  const d = load()
  const account = {
    id: 'offline-' + crypto.randomBytes(6).toString('hex'),
    type: 'offline',
    username: (username || '').trim() || 'Player',
    createdAt: Date.now()
  }
  d.accounts.push(account)
  if (!d.selectedId) d.selectedId = account.id
  save()
  return account
}

function addMicrosoft (data) {
  const d = load()
  const account = {
    id: 'ms-' + crypto.randomBytes(6).toString('hex'),
    type: 'microsoft',
    username: data.username,
    uuid: data.uuid,
    xuid: data.xuid || '',
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: data.expiresAt,
    createdAt: Date.now()
  }
  d.accounts.push(account)
  d.selectedId = account.id
  save()
  return account
}

function remove (id) {
  const d = load()
  d.accounts = d.accounts.filter(a => a.id !== id)
  if (d.selectedId === id) d.selectedId = d.accounts.length ? d.accounts[0].id : null
  save()
}

async function ensureUsable (account) {
  if (!account) return null
  if (account.type === 'offline') return account
  if (!account.xuid) {
    try {
      const updated = await auth.refreshAccount(account)
      Object.assign(account, updated)
      save()
      return account
    } catch {}
  }
  if (account.accessToken && account.expiresAt && Date.now() < account.expiresAt - 60000) return account
  const updated = await auth.refreshAccount(account)
  Object.assign(account, updated)
  save()
  return account
}

function publicView (account) {
  if (!account) return null
  const { accessToken, refreshToken, ...rest } = account
  return rest
}

module.exports = { list, get, selected, setSelected, addOffline, addMicrosoft, remove, ensureUsable, publicView }
