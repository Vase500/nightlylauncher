'use strict'
const fs = require('fs')
const path = require('path')
const paths = require('./paths')
const util = require('./util')
const mojang = require('./mojang')

const FABRIC_META = 'https://meta.fabricmc.net/v2'
const QUILT_META = 'https://meta.quiltmc.org/v3'
const FORGE_MAVEN = 'https://maven.minecraftforge.net'
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases'

function parseXmlVersions (xml) {
  const out = []
  const re = /<version>([^<]+)<\/version>/g
  let m
  while ((m = re.exec(xml))) out.push(m[1])
  return out
}

async function getXml (url) {
  const body = await util.getBuffer(url)
  return body.toString('utf8')
}

const loaderCache = {}

/* ---------------- Fabric ---------------- */

async function fabricVersions (mc) {
  const key = 'fabric-' + mc
  if (loaderCache[key]) return loaderCache[key]
  const arr = await util.getJson(`${FABRIC_META}/versions/loader/${mc}`)
  loaderCache[key] = arr.slice(0, 40).map(v => ({
    loader: v.loader.version,
    installer: 'latest',
    id: v.loader.version,
    stable: !!v.loader.stable
  }))
  return loaderCache[key]
}

async function installFabric (mc, loaderVersion, onProgress, signal) {
  const meta = await util.getJson(`${FABRIC_META}/versions/loader/${mc}/${loaderVersion}/profile/json`)
  const id = meta.id || `fabric-loader-${loaderVersion}-${mc}`
  const dir = paths.versionDir(id)
  util.ensureDirSync(dir)
  fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(meta, null, 2))
  const res = await mojang.ensureVersionInstalled(id, onProgress, signal)
  return { id, ...res }
}

/* ---------------- Quilt ---------------- */

async function quiltVersions (mc) {
  const key = 'quilt-' + mc
  if (loaderCache[key]) return loaderCache[key]
  const arr = await util.getJson(`${QUILT_META}/versions/loader/${mc}`)
  loaderCache[key] = arr.slice(0, 40).map(v => ({
    loader: v.loader.version,
    installer: 'latest',
    id: v.loader.version,
    stable: !v.loader.version.includes('-beta')
  }))
  return loaderCache[key]
}

async function installQuilt (mc, loaderVersion, onProgress, signal) {
  const meta = await util.getJson(`${QUILT_META}/versions/loader/${mc}/${loaderVersion}/profile/json`)
  const id = meta.id || `quilt-loader-${loaderVersion}-${mc}`
  const dir = paths.versionDir(id)
  util.ensureDirSync(dir)
  fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(meta, null, 2))
  const res = await mojang.ensureVersionInstalled(id, onProgress, signal)
  return { id, ...res }
}

/* ---------------- Forge ---------------- */

async function extractMavenLibs (installerJar) {
  const tmp = path.join(paths.cache(), 'embed-' + Date.now())
  util.unzipTo(installerJar, tmp)
  try {
    const maven = path.join(tmp, 'maven')
    if (fs.existsSync(maven)) {
      let copied = 0
      for (const p of util.walk(maven)) {
        const rel = path.relative(maven, p)
        const target = path.join(paths.libraries(), rel)
        if (!fs.existsSync(target)) {
          util.ensureDirSync(path.dirname(target))
          fs.copyFileSync(p, target)
          copied++
        }
      }
      return copied
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  return 0
}

let forgeMeta = null
async function getForgeMeta () {
  if (forgeMeta) return forgeMeta
  const xml = await getXml(`${FORGE_MAVEN}/net/minecraftforge/forge/maven-metadata.xml`)
  forgeMeta = parseXmlVersions(xml)
  return forgeMeta
}

function forgeMcOf (ver) {
  const i = ver.indexOf('-')
  return i === -1 ? null : ver.slice(0, i)
}

async function forgeVersions (mc) {
  const meta = await getForgeMeta()
  return meta
    .filter(v => forgeMcOf(v) === mc)
    .map(v => ({ loader: v.slice(v.indexOf('-') + 1), id: v, build: v }))
    .reverse()
}

async function installForge (mc, build, onProgress, signal) {
  if (build && !build.startsWith(mc + '-')) build = mc + '-' + build
  const installerUrl = `${FORGE_MAVEN}/net/minecraftforge/forge/${build}/forge-${build}-installer.jar`
  const tmpJar = path.join(paths.cache(), `forge-${build}-installer.jar`)
  await util.download(installerUrl, tmpJar, { signal })
  const versionJsonRaw = util.extractZipJson(tmpJar, 'version.json')
  if (!versionJsonRaw) throw new Error('installer missing version.json')
  const meta = JSON.parse(versionJsonRaw)
  const id = meta.id || `forge-${build}`
  const dir = paths.versionDir(id)
  util.ensureDirSync(dir)
  fs.writeFileSync(path.join(dir, id + '.json'), versionJsonRaw)
  await extractMavenLibs(tmpJar)
  const res = await mojang.ensureVersionInstalled(id, onProgress, signal)
  return { id, ...res }
}

/* ---------------- NeoForge ---------------- */

let neoforgeMeta = null
async function getNeoForgeMeta () {
  if (neoforgeMeta) return neoforgeMeta
  const xml = await getXml(`${NEOFORGE_MAVEN}/net/neoforged/neoforge/maven-metadata.xml`)
  neoforgeMeta = parseXmlVersions(xml)
  return neoforgeMeta
}

function neoforgeMcOf (ver) {
  const nums = ver.split('.').filter(p => /^\d+$/.test(p))
  if (nums.length < 2) return null
  return `1.${nums[0]}.${nums[1]}`
}

async function neoforgeVersions (mc) {
  const meta = await getNeoForgeMeta()
  return meta
    .filter(v => neoforgeMcOf(v) === mc)
    .map(v => ({ loader: v, id: v, build: v }))
    .reverse()
}

async function installNeoForge (mc, build, onProgress, signal) {
  const installerUrl = `${NEOFORGE_MAVEN}/net/neoforged/neoforge/${build}/neoforge-${build}-installer.jar`
  const tmpJar = path.join(paths.cache(), `neoforge-${build}-installer.jar`)
  await util.download(installerUrl, tmpJar, { signal })
  const versionJsonRaw = util.extractZipJson(tmpJar, 'version.json')
  if (!versionJsonRaw) throw new Error('installer missing version.json')
  const meta = JSON.parse(versionJsonRaw)
  const id = meta.id || `neoforge-${build}`
  const dir = paths.versionDir(id)
  util.ensureDirSync(dir)
  fs.writeFileSync(path.join(dir, id + '.json'), versionJsonRaw)
  await extractMavenLibs(tmpJar)
  const res = await mojang.ensureVersionInstalled(id, onProgress, signal)
  return { id, ...res }
}

/* ---------------- generic ---------------- */

const LOADERS = {
  vanilla: { label: 'Vanilla', versions: () => [] },
  fabric: { label: 'Fabric', versions: fabricVersions },
  quilt: { label: 'Quilt', versions: quiltVersions },
  forge: { label: 'Forge', versions: forgeVersions },
  neoforge: { label: 'NeoForge', versions: neoforgeVersions }
}

async function listLoaderVersions (loader, mc) {
  const fn = LOADERS[loader]
  if (!fn) return []
  if (loader === 'vanilla') return [{ loader: '', id: 'latest' }]
  return fn.versions(mc)
}

/* ------- supported Minecraft versions per loader ------- */

const supportedCache = {}

async function supportedMinecraftVersions (loader) {
  if (loader === 'vanilla') return null
  if (supportedCache[loader]) return supportedCache[loader]
  let list
  switch (loader) {
    case 'fabric': {
      const arr = await util.getJson(`${FABRIC_META}/versions/game`)
      list = arr.map(v => v.version)
      break
    }
    case 'quilt': {
      const arr = await util.getJson(`${QUILT_META}/versions/game`)
      list = arr.map(v => v.version)
      break
    }
    case 'forge': {
      const meta = await getForgeMeta()
      list = [...new Set(meta.map(forgeMcOf).filter(Boolean))]
      break
    }
    case 'neoforge': {
      const meta = await getNeoForgeMeta()
      list = [...new Set(meta.map(neoforgeMcOf).filter(Boolean))]
      break
    }
    default:
      list = []
  }
  supportedCache[loader] = list
  return list
}

async function installLoader (loader, mc, loaderVersion, onProgress, signal) {
  switch (loader) {
    case 'vanilla': return mojang.ensureVersionInstalled(mc, onProgress, signal)
    case 'fabric': return installFabric(mc, loaderVersion, onProgress, signal)
    case 'quilt': return installQuilt(mc, loaderVersion, onProgress, signal)
    case 'forge': return installForge(mc, loaderVersion, onProgress, signal)
    case 'neoforge': return installNeoForge(mc, loaderVersion, onProgress, signal)
    default: throw new Error('Unknown loader ' + loader)
  }
}

module.exports = {
  LOADERS, listLoaderVersions, installLoader, supportedMinecraftVersions,
  fabricVersions, quiltVersions, forgeVersions, neoforgeVersions,
  installFabric, installQuilt, installForge, installNeoForge,
  neoforgeMcOf, forgeMcOf
}
