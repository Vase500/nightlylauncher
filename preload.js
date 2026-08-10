'use strict'
const { contextBridge, ipcRenderer } = require('electron')

const api = {
  platform: process.platform,
  native: {
    detect: () => ipcRenderer.invoke('native:detect')
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (patch) => ipcRenderer.invoke('config:set', patch)
  },
  versions: {
    list: (filters) => ipcRenderer.invoke('versions:list', filters)
  },
  loaders: {
    list: (loader, mc) => ipcRenderer.invoke('loaders:list', loader, mc),
    supported: (loader) => ipcRenderer.invoke('loaders:supported', loader)
  },
  instances: {
    list: () => ipcRenderer.invoke('instances:list'),
    create: (data) => ipcRenderer.invoke('instances:create', data),
    update: (id, patch) => ipcRenderer.invoke('instances:update', id, patch),
    remove: (id) => ipcRenderer.invoke('instances:remove', id),
    duplicate: (id) => ipcRenderer.invoke('instances:duplicate', id),
    chooseIcon: () => ipcRenderer.invoke('instances:chooseIcon')
  },
  logs: {
    read: (instanceId) => ipcRenderer.invoke('logs:read', instanceId)
  },
  mods: {
    list: (instanceId) => ipcRenderer.invoke('mods:list', instanceId),
    resolveIcons: (instanceId) => ipcRenderer.invoke('mods:resolveIcons', instanceId),
    openFolder: (instanceId) => ipcRenderer.invoke('mods:openFolder', instanceId),
    chooseJar: () => ipcRenderer.invoke('mods:chooseJar'),
    installCustom: (instanceId, srcPath) => ipcRenderer.invoke('mods:installCustom', instanceId, srcPath),
    remove: (instanceId, filename) => ipcRenderer.invoke('mods:remove', instanceId, filename),
    searchModrinth: (query, page) => ipcRenderer.invoke('mods:searchModrinth', query, page),
    modrinthVersions: (instanceId, projectId) => ipcRenderer.invoke('mods:modrinthVersions', instanceId, projectId),
    installModrinth: (instanceId, projectId, versionId, meta, jobId) => ipcRenderer.invoke('mods:installModrinth', instanceId, projectId, versionId, meta, jobId),
    searchCurse: (query, page) => ipcRenderer.invoke('mods:searchCurse', query, page),
    curseFiles: (instanceId, modId) => ipcRenderer.invoke('mods:curseFiles', instanceId, modId),
    installCurse: (instanceId, modId, fileId, meta, jobId) => ipcRenderer.invoke('mods:installCurse', instanceId, modId, fileId, meta, jobId)
  },
  install: {
    loader: (loader, mc, loaderVersion, instanceId) => ipcRenderer.invoke('install:loader', loader, mc, loaderVersion, instanceId),
    cancel: (jobId) => ipcRenderer.invoke('install:cancel', jobId)
  },
  launch: {
    start: (instanceId) => ipcRenderer.invoke('launch:start', instanceId),
    stop: (instanceId) => ipcRenderer.invoke('launch:stop', instanceId),
    running: (instanceId) => ipcRenderer.invoke('launch:running', instanceId),
    onLog: (cb) => ipcRenderer.on('launch:log', (e, p) => cb(p)),
    onProgress: (cb) => ipcRenderer.on('launch:progress', (e, p) => cb(p)),
    onExit: (cb) => ipcRenderer.on('launch:exit', (e, p) => cb(p))
  },
  packs: {
    detect: (file) => ipcRenderer.invoke('packs:detect', file),
    recommendedRam: (file) => ipcRenderer.invoke('packs:recommendedRam', file),
    import: (file, opts, jobId) => ipcRenderer.invoke('packs:import', file, opts, jobId),
    defaultDownloadDir: () => ipcRenderer.invoke('packs:defaultDownloadDir'),
    choose: () => ipcRenderer.invoke('packs:choose')
  },
  modrinth: {
    search: (query, page) => ipcRenderer.invoke('modrinth:search', query, page),
    get: (id) => ipcRenderer.invoke('modrinth:get', id),
    versions: (id) => ipcRenderer.invoke('modrinth:versions', id),
    import: (id, versionId, opts, jobId) => ipcRenderer.invoke('modrinth:import', id, versionId, opts, jobId)
  },
  curse: {
    search: (query, page) => ipcRenderer.invoke('curse:search', query, page),
    mod: (id) => ipcRenderer.invoke('curse:mod', id),
    files: (id, opts) => ipcRenderer.invoke('curse:files', id, opts),
    import: (modId, fileId, opts, jobId) => ipcRenderer.invoke('curse:import', modId, fileId, opts, jobId)
  },
  java: {
    detect: () => ipcRenderer.invoke('java:detect'),
    listProviderVersions: (provider) => ipcRenderer.invoke('java:listProviderVersions', provider),
    downloadProvider: (provider, value) => ipcRenderer.invoke('java:downloadProvider', provider, value)
  },
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    selected: () => ipcRenderer.invoke('accounts:selected'),
    setSelected: (id) => ipcRenderer.invoke('accounts:setSelected', id),
    addOffline: (username) => ipcRenderer.invoke('accounts:addOffline', username),
    remove: (id) => ipcRenderer.invoke('accounts:remove', id)
  },
  skins: {
    profile: (accountId) => ipcRenderer.invoke('skins:profile', accountId),
    byUsername: (username) => ipcRenderer.invoke('skins:byUsername', username),
    upload: (accountId, filePath, variant) => ipcRenderer.invoke('skins:upload', accountId, filePath, variant),
    uploadData: (accountId, dataUrl, variant) => ipcRenderer.invoke('skins:uploadData', accountId, dataUrl, variant),
    remove: (accountId, skinId) => ipcRenderer.invoke('skins:remove', accountId, skinId),

    setCape: (accountId, capeId) => ipcRenderer.invoke('skins:setCape', accountId, capeId),
    choose: () => ipcRenderer.invoke('skins:choose')
  },
  auth: {
    deviceCode: () => ipcRenderer.invoke('auth:deviceCode'),
    poll: (deviceCode) => ipcRenderer.invoke('auth:poll', deviceCode)
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    onMaximized: (cb) => ipcRenderer.on('window:maximized', (e, v) => cb(v))
  },
  open: (url) => ipcRenderer.invoke('open:external', url),
  onImportProgress: (cb) => ipcRenderer.on('import:progress', (e, p) => cb(p))
}

contextBridge.exposeInMainWorld('nightly', api)
