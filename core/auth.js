'use strict'
const { postForm, postJson, getJson } = require('./util')

const CLIENT_ID = '00000000402b5328'
const SCOPE = 'service::user.auth.xboxlive.com::MBI_SSL'
const DEVICE_CODE_URL = 'https://login.live.com/oauth20_connect.srf'
const TOKEN_URL = 'https://login.live.com/oauth20_token.srf'
const XBL_URL = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const MC_LOGIN_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'

function errorBody (err) {
  try {
    if (err.body) {
      const data = JSON.parse(err.body.toString('utf8'))
      return data.error || data.message || ''
    }
  } catch {}
  return ''
}

function xstsErrorMessage (err) {
  try {
    if (err.body) {
      const data = JSON.parse(err.body.toString('utf8'))
      if (data.XErr === 2148916233) return 'This account does not own Minecraft (no XBOX Live subscription).'
      if (data.XErr === 2148916238) return 'This account is under 18 and needs a Microsoft family guardian.'
      if (data.XErr === 2148916235) return 'This account does not have XBOX Live service.'
      return data.message || ''
    }
  } catch {}
  return ''
}

async function requestDeviceCode () {
  const res = await postForm(DEVICE_CODE_URL, {
    client_id: CLIENT_ID,
    response_type: 'device_code',
    scope: SCOPE
  })
  return {
    deviceCode: res.device_code,
    userCode: res.user_code,
    verificationUri: res.verification_uri,
    interval: res.interval || 5,
    expiresIn: res.expires_in,
    message: res.message
  }
}

async function pollToken (deviceCode) {
  let res
  try {
    res = await postForm(TOKEN_URL, {
      client_id: CLIENT_ID,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode
    })
  } catch (err) {
    if (err.status === 400) {
      const code = errorBody(err)
      if (code) {
        const pending = new Error(code)
        pending.code = code
        throw pending
      }
    }
    throw err
  }
  if (!res.access_token) throw new Error('Unexpected device code response')
  const mc = await minecraftLogin(res.access_token)
  return {
    accessToken: mc.accessToken,
    refreshToken: res.refresh_token,
    expiresAt: Date.now() + (res.expires_in || 3600) * 1000,
    username: mc.username,
    uuid: mc.uuid
  }
}

async function refreshAccount (account) {
  const res = await postForm(TOKEN_URL, {
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: account.refreshToken,
    scope: SCOPE
  })
  const mc = await minecraftLogin(res.access_token)
  return {
    accessToken: mc.accessToken,
    refreshToken: res.refresh_token || account.refreshToken,
    expiresAt: Date.now() + (res.expires_in || 3600) * 1000,
    username: mc.username,
    uuid: mc.uuid
  }
}

async function minecraftLogin (msAccessToken) {
  let xbl
  try {
    xbl = await postJson(XBL_URL, {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 't=' + msAccessToken },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    }, { 'x-xbl-contract-version': '1' })
  } catch (err) {
    throw new Error('Xbox Live authentication failed: ' + (errorBody(err) || err.message))
  }
  const xblToken = xbl.Token
  const xui = xbl.DisplayClaims && xbl.DisplayClaims.xui && xbl.DisplayClaims.xui[0]
  const uhs = xui && xui.uhs
  if (!xblToken || !uhs) throw new Error('Xbox Live authentication failed: unexpected response')

  let xsts
  try {
    xsts = await postJson(XSTS_URL, {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    }, { 'x-xbl-contract-version': '1' })
  } catch (err) {
    throw new Error('XSTS authentication failed: ' + (xstsErrorMessage(err) || errorBody(err) || err.message))
  }
  const xstsToken = xsts.Token
  const xstsUhs = xsts.DisplayClaims && xsts.DisplayClaims.xui && xsts.DisplayClaims.xui[0] && xsts.DisplayClaims.xui[0].uhs
  if (!xstsToken || !xstsUhs) throw new Error('XSTS authentication failed: unexpected response')

  let mc
  try {
    mc = await postJson(MC_LOGIN_URL, { identityToken: `XBL3.0 x=${xstsUhs};${xstsToken}` })
  } catch (err) {
    throw new Error('Minecraft login failed: ' + (errorBody(err) || err.message))
  }
  if (!mc.access_token) throw new Error('Minecraft login failed: unexpected response')

  let profile = null
  try {
    profile = await getJson(PROFILE_URL, { Authorization: 'Bearer ' + mc.access_token })
  } catch {}
  const name = (profile && profile.name) || 'Player'
  const uuid = (profile && profile.id) || ''
  return { accessToken: mc.access_token, username: name, uuid, xuid: (xui && xui.xid) || '' }
}

module.exports = { requestDeviceCode, pollToken, refreshAccount }
