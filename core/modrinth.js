'use strict'
const util = require('./util')

const BASE = 'https://api.modrinth.com/v2'

async function search ({ query, limit = 20, offset = 0, type = 'modpack' }) {
  const facets = [[`project_type:${type}`]]
  const qs = new URLSearchParams({
    query: query || '',
    limit: String(limit),
    offset: String(offset),
    facets: JSON.stringify(facets)
  })
  const data = await util.request(`${BASE}/search?${qs}`, { json: true, headers: { 'User-Agent': 'nightly-launcher/1.0' } })
  return (data.hits || []).map(hit => ({
    id: hit.project_id,
    slug: hit.slug,
    title: hit.title,
    description: hit.description,
    author: hit.author,
    downloads: hit.downloads,
    follows: hit.follows,
    updated: hit.updated,
    icon: hit.icon_url,
    versions: hit.versions,
    client: hit.client_side,
    server: hit.server_side,
    totalHits: data.total_hits
  }))
}

async function getProject (id) {
  const p = await util.request(`${BASE}/project/${encodeURIComponent(id)}`, { json: true, headers: { 'User-Agent': 'nightly-launcher/1.0' } })
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    body: p.body,
    icon: p.icon_url,
    downloads: p.downloads,
    followers: p.followers,
    client: p.client_side,
    server: p.server_side,
    versions: p.versions
  }
}

async function getProjects (ids) {
  const arr = (Array.isArray(ids) ? ids : [ids]).map(x => String(x).trim()).filter(Boolean)
  if (!arr.length) return []
  const out = []
  for (let i = 0; i < arr.length; i += 50) {
    const qs = new URLSearchParams({ ids: JSON.stringify(arr.slice(i, i + 50)) })
    const data = await util.request(`${BASE}/projects?${qs}`, { json: true, headers: { 'User-Agent': 'nightly-launcher/1.0' } })
    for (const p of data || []) out.push({
      id: p.id,
      slug: p.slug,
      title: p.title,
      description: p.description,
      icon: p.icon_url,
      downloads: p.downloads,
      author: p.author,
      versions: p.versions,
      client: p.client_side,
      server: p.server_side
    })
  }
  return out
}

async function getVersions (projectId, { gameVersions, loaders } = {}) {
  const qs = new URLSearchParams()
  if (gameVersions && gameVersions.length) qs.set('game_versions', JSON.stringify(gameVersions))
  if (loaders && loaders.length) qs.set('loaders', JSON.stringify(loaders))
  const data = await util.request(`${BASE}/project/${encodeURIComponent(projectId)}/version?${qs}`, { json: true, headers: { 'User-Agent': 'nightly-launcher/1.0' } })
  return (data || []).map(v => ({
    id: v.id,
    name: v.name,
    version_number: v.version_number,
    game_versions: v.game_versions,
    loaders: v.loaders,
    published: v.date_published,
    downloads: v.downloads,
    featured: v.featured,
    files: (v.files || []).map(f => ({
      filename: f.filename,
      url: f.url,
      size: f.size,
      primary: !!f.primary,
      hashes: f.hashes || {}
    }))
  }))
}

async function versionFile (projectId, versionId) {
  const versions = await getVersions(projectId)
  const target = versions.find(v => v.id === versionId) || versions[0]
  if (!target) throw new Error('No files found for this project')
  const file = target.files.find(f => f.primary) || target.files[0]
  if (!file) throw new Error('No download file found')
  return { file, version: target }
}

async function downloadPack (projectId, versionId, destPath, onProgress, signal) {
  const { file } = await versionFile(projectId, versionId)
  await util.download(file.url, destPath, { onProgress, signal })
  return file
}

module.exports = { search, getProject, getProjects, getVersions, downloadPack, versionFile }
