'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const os = require('os')
const { spawn } = require('child_process')
const paths = require('./paths')
const config = require('./config')
const mojang = require('./mojang')
const java = require('./java')
const accounts = require('./accounts')
const util = require('./util')
const instances = require('./instances')

const running = new Map()

function classpathSeparator () {
  return process.platform === 'win32' ? ';' : ':'
}

function classpathFor (libs, gameJar) {
  const parts = libs.map(l => mojang.libLocalPath(l))
  parts.push(gameJar)
  return parts.join(classpathSeparator())
}

function parseUuid (username) {
  const h = crypto.createHash('md5').update(username).digest('hex')
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20, 32)
}

function buildTokens (opts) {
  const cfg = config.load()
  const gameDir = opts.gameDir
  const tokens = {
    'auth_player_name': opts.username,
    'version_name': opts.versionId,
    'game_directory': gameDir,
    'game_dir': gameDir,
    'assets_root': paths.assets(),
    'assets_index_name': opts.assetIndex,
    'auth_uuid': opts.uuid,
    'auth_access_token': opts.token || '0',
    'user_type': opts.userType || 'legacy',
    'user_properties': '{}',
    'resolution_width': String(opts.width),
    'resolution_height': String(opts.height),
    'natives_directory': opts.nativesDir,
    'launcher_name': 'Nightly',
    'launcher_version': '1.0',
    'classpath_separator': classpathSeparator(),
    'library_directory': paths.libraries(),
    'classpath': opts.classpath,
    'username': opts.username,
    'clientid': opts.clientId || '00000000000000000000000000000000',
    'auth_xuid': opts.xuid || '',
    'version_type': opts.versionType || 'release',
    'quickPlayPath': '',
    'quickPlaySingleplayer': '',
    'quickPlayMultiplayer': '',
    'quickPlayRealms': ''
  }
  return tokens
}

function replaceTokens (arg, tokens) {
  return arg.replace(/\$\{(\w+)\}/g, (m, key) => {
    if (key in tokens) return tokens[key]
    return m
  })
}

function isModern (tree) {
  return !!(tree[0].arguments)
}

function mergeArgs (tree, kind) {
  const out = []
  for (const v of tree) {
    if (v.arguments && Array.isArray(v.arguments[kind])) out.push(...v.arguments[kind])
  }
  return out
}

const FEATURES = {
  is_demo_user: false,
  has_custom_resolution: true,
  has_quick_plays_support: false,
  is_quick_play_singleplayer: false,
  is_quick_play_multiplayer: false,
  is_quick_play_realms: false
}

function ruleMatches (rule, features) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== util.osName()) return false
    if (rule.os.arch) {
      const ok = (rule.os.arch === 'x86' && (process.arch === 'ia32' || process.arch === 'x64')) ||
        (rule.os.arch === 'x86_64' && process.arch === 'x64') ||
        (rule.os.arch === 'arm64' && process.arch === 'arm64')
      if (!ok) return false
    }
  }
  if (rule.features) {
    for (const [k, v] of Object.entries(rule.features)) {
      if (features[k] !== v) return false
    }
  }
  return true
}

function applyRule (list, features) {
  const out = []
  for (const item of list || []) {
    if (typeof item === 'string') {
      out.push(item)
    } else if (item && item.rules) {
      let allowed = false
      for (const rule of item.rules) {
        if (ruleMatches(rule, features)) allowed = rule.action !== 'disallow' && rule.action !== 'deny'
      }
      if (allowed) {
        out.push(...(Array.isArray(item.value) ? item.value : [item.value]))
      }
    }
  }
  return out
}

function splitArgs (str) {
  const out = []
  let cur = ''
  let quote = null
  for (let i = 0; i < String(str).length; i++) {
    const c = String(str)[i]
    if (quote) {
      if (c === quote) quote = null
      else cur += c
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === ' ' || c === '\t') {
      if (cur) { out.push(cur); cur = '' }
    } else {
      cur += c
    }
  }
  if (cur) out.push(cur)
  return out
}

function buildArgs (tree, tokens, opts, cfg, nativesDir, javaMajor) {
  const versionJson = tree[tree.length - 1]
  const args = []

  if (opts.fullscreen) args.push('-Dorg.lwjgl.opengl.Window.fullscreen=true')

  const userJvm = splitArgs(opts.jvmArgs || '')
  const jvm = [
    `-Xmx${opts.maxMemory}M`,
    `-Xms${opts.minMemory}M`
  ].concat(userJvm)

  if (isModern(tree)) {
    const versionJvm = applyRule(mergeArgs(tree, 'jvm'), FEATURES).filter(a => {
      if (typeof a !== 'string') return true
      if (a.startsWith('--sun-misc-unsafe-memory-access=')) return (javaMajor || 0) >= 22
      if (a.startsWith('--enable-native-access=')) return (javaMajor || 0) >= 17
      return true
    })
    if (!versionJvm.some(a => a === '${classpath}')) versionJvm.unshift('-cp', '${classpath}')
    if (!versionJvm.some(a => String(a).includes('java.library.path'))) versionJvm.unshift('-Djava.library.path=${natives_directory}')
    jvm.push(...versionJvm)

    const game = applyRule(mergeArgs(tree, 'game'), FEATURES)
    args.push(...jvm)
    args.push(versionJson.mainClass)
    args.push(...game)
  } else {
    jvm.push('-Djava.library.path=' + nativesDir)
    jvm.push('-cp', tokens.classpath)
    args.push(...jvm)
    args.push(versionJson.mainClass)
    const legacy = (tree.find(v => v.minecraftArguments) || {}).minecraftArguments || ''
    args.push(...legacy.trim().split(/\s+/).filter(Boolean))
  }

  const quickPlayFlags = new Set(['--quickPlayPath', '--quickPlaySingleplayer', '--quickPlayMultiplayer', '--quickPlayRealms'])
  const out = []
  for (let i = 0; i < args.length; i++) {
    const a = replaceTokens(args[i], tokens)
    const next = i + 1 < args.length ? replaceTokens(args[i + 1], tokens) : null
    if (quickPlayFlags.has(a) && next === '') {
      i++
      continue
    }
    out.push(a)
  }
  return out
}

async function prepare (instance, onProgress) {
  const cfg = config.load()
  const versionId = instance.versionId || (instance.loader === 'vanilla' ? instance.mcVersion : null)
  if (!versionId) throw new Error('Instance has no version selected')

  await mojang.ensureVersionInstalled(versionId, onProgress)

  const tree = await mojang.resolveVersionTree(versionId)
  const libs = mojang.collectLibraries(tree)
  const gameJar = path.join(paths.versionDir(versionId), versionId + '.jar')
  if (!fs.existsSync(gameJar)) throw new Error('Game jar missing: ' + gameJar)

  const nativesDir = mojang.nativesDir(versionId)
  const assetIndex = tree[0].assetIndex ? tree[0].assetIndex.id : null

  const account = await accounts.ensureUsable(accounts.selected())
  if (!account) throw new Error('No account selected. Set up an account in Settings.')
  const username = account.username || cfg.username || 'Player'
  const uuid = account.type === 'microsoft' ? (account.uuid || parseUuid(username)) : parseUuid(username)
  const classpath = classpathFor(libs, gameJar)

  const useCustomMem = !!instance.customMemory && (instance.maxMemory || instance.minMemory)
  const opts = {
    username,
    uuid,
    xuid: account.type === 'microsoft' ? (account.xuid || '') : '',
    token: account.type === 'microsoft' ? (account.accessToken || '0') : '0',
    userType: account.type === 'microsoft' ? 'msa' : 'legacy',
    versionId,
    gameDir: paths.instanceDir(instance.id),
    classpath,
    assetIndex,
    nativesDir,
    maxMemory: useCustomMem ? (instance.maxMemory || cfg.maxMemory || 4096) : (cfg.maxMemory || 4096),
    minMemory: useCustomMem ? (instance.minMemory || cfg.minMemory || 512) : (cfg.minMemory || 512),
    width: (instance.resolution && instance.resolution.width) || cfg.resolution.width,
    height: (instance.resolution && instance.resolution.height) || cfg.resolution.height,
    fullscreen: instance.fullscreen,
    jvmArgs: instance.jvmArgs || cfg.jvmArgs || '',
    versionType: (tree[tree.length - 1].type || 'release'),
    clientId: '00000000000000000000000000000000'
  }

  return { opts, tree, nativesDir }
}

function javaRequired (tree) {
  let major = 8
  for (const v of tree) {
    if (v && v.javaVersion && v.javaVersion.majorVersion) {
      if (v.javaVersion.majorVersion > major) major = v.javaVersion.majorVersion
    }
  }
  return major
}

async function resolveJavaPath (instance, required, onProgress, onLog) {
  const cfg = config.load()
  const candidates = []
  if (instance.javaPath && fs.existsSync(instance.javaPath)) candidates.push(instance.javaPath)
  if (cfg.javaPath && fs.existsSync(cfg.javaPath)) candidates.push(cfg.javaPath)
  for (const p of candidates) {
    const ver = java.getJavaVersion(p)
    if (ver && ver >= required) return p
    if (onLog) onLog('Java', 'Configured Java ' + (ver || '?') + ' is too old for this version (needs ' + required + '+), picking another')
  }
  const detected = java.detectJava()
  const best = java.pickBestFor(detected, required)
  if (best) return best.path
  if (config.load().autoDownloadJava === false) {
    throw new Error('No suitable Java found and auto-download is disabled in Settings. Set a Java path or download one there.')
  }
  try {
    const exe = await java.ensureJavaFor(required, onProgress)
    if (onLog) onLog('Java', 'Downloaded Java ' + required + ' automatically')
    return exe
  } catch (e) {
    throw new Error('No suitable Java found. Set a Java path in Settings or download one there. (' + e.message + ')')
  }
}

async function launch (instance, { onProgress, onLog, onExit } = {}) {
  const { opts, tree, nativesDir } = await prepare(instance, onProgress)
  const javaPath = await resolveJavaPath(instance, javaRequired(tree), onProgress, onLog)
  if (!javaPath) throw new Error('No Java found. Install Java or set a Java path in Settings.')

  const tokens = buildTokens(opts)
  const args = buildArgs(tree, tokens, opts, config.load(), nativesDir, java.getJavaVersion(javaPath))

  util.ensureDirSync(opts.gameDir)

  if (onLog) {
    onLog('Nightly Launcher', `Launching ${instance.name}`)
    onLog('Java', javaPath)
    onLog('Command', `java ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`)
  }

  const proc = spawn(javaPath, args, {
    cwd: opts.gameDir,
    env: Object.assign({}, process.env, {
      APPDATA: process.env.APPDATA,
      MinecraftNativesDir: nativesDir,
      JAVA_HOME: path.dirname(path.dirname(javaPath))
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })

  const handle = { proc, pid: proc.pid, instanceId: instance.id, exited: false, startedAt: Date.now() }
  running.set(instance.id, handle)

  const buffer = (stream, tag) => {
    let data = ''
    stream.on('data', chunk => {
      data += chunk.toString()
      let nl
      while ((nl = data.indexOf('\n')) !== -1) {
        const line = data.slice(0, nl).replace(/\r$/, '')
        data = data.slice(nl + 1)
        if (line && onLog) onLog(tag, line)
      }
    })
  }
  buffer(proc.stdout, 'MC')
  buffer(proc.stderr, 'ERR')

  proc.on('error', err => {
    handle.exited = true
    running.delete(instance.id)
    if (onExit) onExit({ code: -1, error: err.message })
  })

  proc.on('close', (code, signal) => {
    handle.exited = true
    running.delete(instance.id)
    if (config.load().trackPlaytime !== false) {
      try {
        const elapsed = Date.now() - (handle.startedAt || Date.now())
        const cur = instances.get(instance.id)
        if (cur) instances.update(instance.id, { playtimeMs: (cur.playtimeMs || 0) + elapsed, lastPlayed: Date.now() })
      } catch {}
    }
    if (onExit) onExit({ code, signal })
  })

  return handle
}

function isRunning (instanceId) {
  const h = running.get(instanceId)
  return !!(h && !h.exited)
}

function stop (instanceId) {
  const h = running.get(instanceId)
  if (h && !h.exited) {
    try {
      if (process.platform === 'win32') {
        const taskkill = spawn('taskkill', ['/pid', String(h.proc.pid), '/t', '/f'], { windowsHide: true })
        taskkill.on('error', () => {})
      } else {
        try { process.kill(h.proc.pid, 'SIGTERM') } catch {}
      }
    } catch {}
  }
}

module.exports = { launch, isRunning, stop, buildArgs, prepare, buildTokens, resolveJavaPath, javaRequired }
