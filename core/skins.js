'use strict'
const fs = require('fs')
const { getBuffer, request } = require('./util')
const accounts = require('./accounts')

const PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'
const SKINS_URL = 'https://api.minecraftservices.com/minecraft/profile/skins'
const CAPES_URL = 'https://api.minecraftservices.com/minecraft/profile/capes/active'
const MOJANG_NAME_URL = 'https://api.mojang.com/users/profiles/minecraft/'
const MOJANG_SESSION_URL = 'https://sessionserver.mojang.com/session/minecraft/profile/'

async function ensureAccount (accountId) {
  const acc = await accounts.ensureUsable(accounts.get(accountId))
  if (!acc) throw new Error('Account not found')
  return acc
}

function authHeaders (account) {
  return { Authorization: 'Bearer ' + account.accessToken }
}

async function fetchProfile (account) {
  return request(PROFILE_URL, { headers: authHeaders(account), json: true })
}

async function imageDataUrl (url) {
  try {
    const buf = await getBuffer(url)
    const mime = /\.gif$/i.test(url) ? 'image/gif' : 'image/png'
    return 'data:' + mime + ';base64,' + buf.toString('base64')
  } catch {
    return url
  }
}

async function decorate (profile) {
  if (!profile || typeof profile !== 'object') return profile
  const out = Object.assign({}, profile)
  out.skins = await Promise.all((out.skins || []).map(async s => {
    const copy = Object.assign({}, s)
    if (s.url) copy.url = await imageDataUrl(s.url)
    return copy
  }))
  out.capes = await Promise.all((out.capes || []).map(async c => {
    const copy = Object.assign({}, c)
    if (c.url) copy.url = await imageDataUrl(c.url)
    return copy
  }))
  return out
}

async function profile (accountId) {
  const acc = await ensureAccount(accountId)
  return decorate(await fetchProfile(acc))
}

const byUsernameCache = new Map()

async function byUsername (username) {
  const uname = String(username || '').trim()
  if (!uname) return null
  if (byUsernameCache.has(uname)) return byUsernameCache.get(uname)
  let result = null
  try {
    const nameProfile = await request(MOJANG_NAME_URL + encodeURIComponent(uname), { json: true })
    if (nameProfile && nameProfile.id) {
      const session = await request(MOJANG_SESSION_URL + nameProfile.id, { json: true })
      const textures = (session.properties || []).find(p => p.name === 'textures')
      if (textures && textures.value) {
        const tex = JSON.parse(Buffer.from(textures.value, 'base64').toString('utf8'))
        const skin = tex.textures && tex.textures.SKIN
        if (skin && skin.url) {
          result = {
            skin: await imageDataUrl(skin.url),
            cape: tex.textures && tex.textures.CAPE ? await imageDataUrl(tex.textures.CAPE.url) : null,
            slim: !!(skin.metadata && skin.metadata.model === 'slim')
          }
        }
      }
    }
  } catch {}
  byUsernameCache.set(uname, result)
  return result
}

function buildMultipart (data, mime, ext, variant) {
  const boundary = '----nightly' + Date.now().toString(16) + Math.random().toString(16).slice(2)
  const head = Buffer.from(
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="variant"\r\n\r\n' + variant + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="file"; filename="skin.' + ext + '"\r\n' +
    'Content-Type: ' + mime + '\r\n\r\n', 'utf8')
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8')
  return { body: Buffer.concat([head, data, tail]), boundary }
}

async function postSkin (accountId, data, mime, ext, variant) {
  const acc = await ensureAccount(accountId)
  const v = variant === 'SLIM' ? 'SLIM' : 'CLASSIC'
  const part = buildMultipart(data, mime, ext, v)
  let res
  try {
    res = await request(SKINS_URL, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'multipart/form-data; boundary=' + part.boundary }, authHeaders(acc)),
      body: part.body,
      json: true
    })
  } catch (err) {
    if (err.status === 400) {
      const msg = /"errorMessage"\s*:\s*"([^"]+)/.test((err.body || '').toString())
        ? /"errorMessage"\s*:\s*"([^"]+)/.exec((err.body || '').toString())[1]
        : 'Invalid skin image'
      throw new Error(msg)
    }
    throw err
  }
  return decorate(res || (await fetchProfile(acc)))
}

async function uploadSkin (accountId, filePath, variant) {
  const data = fs.readFileSync(filePath)
  const extMatch = /\.(png|jpg|jpeg|gif)$/i.exec(filePath)
  const ext = extMatch ? extMatch[0].slice(1).toLowerCase() : 'png'
  const mime = ext === 'gif' ? 'image/gif' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
  return postSkin(accountId, data, mime, ext, variant)
}

async function uploadSkinData (accountId, dataUrl, variant) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '')
  if (!match) throw new Error('Invalid skin image data')
  const data = Buffer.from(match[2], 'base64')
  const mime = match[1]
  const ext = mime === 'image/gif' ? 'gif' : mime === 'image/jpeg' ? 'jpeg' : 'png'
  return postSkin(accountId, data, mime, ext, variant)
}

async function removeSkin (accountId, skinId) {
  const acc = await ensureAccount(accountId)
  let res
  try {
    res = await request(SKINS_URL + '/' + encodeURIComponent(skinId), {
      method: 'DELETE',
      headers: authHeaders(acc),
      json: true
    })
  } catch (err) {
    if (err.status === 404) throw new Error('Skin not found')
    throw err
  }
  return decorate(res || (await fetchProfile(acc)))
}

async function setActiveCape (accountId, capeId) {
  const acc = await ensureAccount(accountId)
  let res
  try {
    res = await request(CAPES_URL, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(acc)),
      body: Buffer.from(JSON.stringify({ capeId: capeId }), 'utf8'),
      json: true
    })
  } catch (err) {
    if (err.status === 400) throw new Error('This account does not own that cape')
    throw err
  }
  return decorate(res || (await fetchProfile(acc)))
}

module.exports = { profile, byUsername, uploadSkin, uploadSkinData, removeSkin, setActiveCape }
