'use strict'

/* ---------- helpers ---------- */

const api = window.nightly

function el (tag, props = {}, children = []) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v
    else if (k === 'text') node.textContent = v
    else if (k === 'html') node.innerHTML = v
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v)
    else if (k === 'checked' || k === 'disabled' || k === 'value' || k === 'selected') node[k] = v
    else if (k === 'attrs' && v && typeof v === 'object') {
      for (const [ak, av] of Object.entries(v)) if (av !== null && av !== undefined) node.setAttribute(ak, av)
    }
    else if (v !== null && v !== undefined) node.setAttribute(k, v)
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return node
}

function fitOneLine (node, minPx) {
  if (!node) return
  node.style.fontSize = ''
  let size = parseFloat(getComputedStyle(node).fontSize) || 13
  while (node.scrollWidth > node.clientWidth && size > (minPx || 11)) {
    size -= 0.5
    node.style.fontSize = size + 'px'
  }
}

function fmtBytes (n) {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0; let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return v.toFixed(i === 0 ? 0 : 1) + ' ' + u[i]
}

function fmtDate (ts) {
  if (!ts) return 'Never'
  const d = new Date(ts)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtPlaytime (ms) {
  if (!ms) return '0 min'
  const mins = Math.round(ms / 60000)
  if (mins < 60) return mins + ' min'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? h + ' h ' + m + ' min' : h + ' h'
}

function requiredJavaMajor (mc) {
  const v = String(mc || '').trim()
  const m = v.match(/^1\.(\d+)(?:\.(\d+))?/)
  if (m) {
    const minor = parseInt(m[1], 10)
    if (minor < 9) return 8
    if (minor < 17) return 8
    if (minor === 17) return 16
    if (minor < 20) return 17
    if (minor === 20) return parseInt(m[2] || 0, 10) >= 5 ? 21 : 17
    return 21
  }
  if (/^\d+w\d+[a-z]/.test(v)) return 17
  return 8
}

function shortJavaLabel (j) {
  let short = ''
  if (j && j.path) {
    const parts = j.path.replace(/\\/g, '/').split('/').filter(Boolean)
    const file = parts.pop() || ''
    const dir = parts.pop() || ''
    const cand = [file, dir].filter(x => /jdk|jre|java/i.test(x)).sort((a, b) => b.length - a.length)[0]
    if (cand) short = ' \u00b7 ' + cand
  }
  return 'Java ' + (j && j.version || '?') + short
}

function toast (msg, type = 'info') {
  const t = el('div', { class: 'toast ' + (type === 'info' ? '' : type), text: msg })
  document.getElementById('toast-root').appendChild(t)
  setTimeout(() => t.remove(), 4200)
}

function openModal (content, handlers) {
  const root = document.getElementById('modal-root')
  root.innerHTML = ''
  root.classList.add('open')
  root.appendChild(el('div', { class: 'modal-backdrop', onclick: () => closeModal() }))
  const box = el('div', { class: 'modal' })
  box.appendChild(content)
  root.appendChild(box)
  if (handlers) handlers(root, box)
}

function closeModal () {
  document.getElementById('modal-root').classList.remove('open')
  document.getElementById('modal-root').innerHTML = ''
}

function modalShell (title, body) {
  return el('div', {}, [
    el('button', { class: 'close', text: '\u2715', onclick: () => closeModal() }),
    el('h3', { text: title }),
    body
  ])
}

function inlinePrompt (title, placeholder) {
  return new Promise(resolve => {
    const root = document.getElementById('modal-root')
    const overlay = el('div', { class: 'inline-prompt-backdrop' })
    const input = el('input', { class: 'input', placeholder: placeholder || '', value: '' })
    const done = val => { overlay.remove(); resolve(val) }
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') done(input.value.trim() || null)
      if (e.key === 'Escape') done(null)
    })
    overlay.appendChild(el('div', { class: 'inline-prompt-box' }, [
      el('div', { class: 'inline-prompt-title', text: title }),
      input,
      el('div', { class: 'inline-prompt-actions' }, [
        el('button', { class: 'btn', text: 'Cancel', onclick: () => done(null) }),
        el('button', { class: 'btn primary', text: 'OK', onclick: () => done(input.value.trim() || null) })
      ])
    ]))
    root.appendChild(overlay)
    input.focus()
    input.select()
  })
}

/* ---------- accounts ---------- */

function promptForUsername (title, def) {
  return new Promise(resolve => {
    const input = el('input', { value: def || '', placeholder: 'Player' })
    input.addEventListener('keydown', e => { if (e.key === 'Enter') ok() })
    function ok () {
      const v = input.value.trim()
      closeModal()
      resolve(v || 'Player')
    }
    openModal(modalShell(title, el('div', {}, [
      el('div', { class: 'form-field' }, [el('label', { text: 'Username' }), input]),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn', text: 'Cancel', onclick: () => { closeModal(); resolve(null) } }),
        el('button', { class: 'btn primary', text: 'Continue', onclick: ok })
      ])
    ])))
  })
}

function beginMicrosoftLogin () {
  return new Promise((resolve, reject) => {
    let deviceCode = null
    let interval = 5
    let polling = null
    let stopped = false

    const userCodeEl = el('div', { class: 'auth-code', text: '\u2026' })
    const urlEl = el('div', { class: 'auth-url', text: 'Starting sign in...' })
    const statusEl = el('div', { class: 'hint', text: ' ' })
    const openBtn = el('button', { class: 'btn primary', text: 'Open link' })
    const cancelBtn = el('button', { class: 'btn', text: 'Cancel' })

    openModal(el('div', {}, [
      el('h3', { text: 'Sign in with Microsoft' }),
      el('p', { text: 'Open the link in your browser, enter the code below, and sign in to link your Minecraft account.' }),
      userCodeEl,
      el('div', { class: 'auth-row' }, [urlEl, openBtn]),
      statusEl,
      el('div', { class: 'modal-actions' }, [cancelBtn])
    ]))

    function stop () {
      stopped = true
      if (polling) clearTimeout(polling)
    }

    cancelBtn.addEventListener('click', () => {
      stop()
      closeModal()
      reject(Object.assign(new Error('cancelled'), { cancelled: true }))
    })

    async function poll () {
      if (stopped) return
      try {
        const res = await api.auth.poll(deviceCode)
        if (res.ok) {
          stop()
          closeModal()
          resolve(res.account)
          return
        }
        const code = res.code || ''
        if (code === 'authorization_pending' || code === 'slow_down') {
          statusEl.textContent = 'Waiting for you to sign in...'
          polling = setTimeout(poll, Math.max(interval, 5) * 1000)
        } else if (code === 'expired_token') {
          statusEl.textContent = 'The code expired. Click Cancel and try again.'
        } else if (code === 'authorization_declined') {
          statusEl.textContent = 'You declined the request.'
        } else if (code === 'access_denied') {
          statusEl.textContent = 'You denied the request.'
        } else {
          statusEl.textContent = 'Sign in failed: ' + code
        }
      } catch (e) {
        if (stopped) return
        statusEl.textContent = 'Sign in failed: ' + e.message
      }
    }

    api.auth.deviceCode().then(info => {
      if (stopped) return
      deviceCode = info.deviceCode
      interval = info.interval || 5
      userCodeEl.textContent = info.userCode
      urlEl.textContent = info.verificationUri
      openBtn.addEventListener('click', () => api.open(info.verificationUri))
      statusEl.textContent = 'Waiting for you to sign in...'
      poll()
    }).catch(e => {
      statusEl.textContent = 'Failed to start sign in: ' + e.message
    })
  })
}

function showNoAccountDialog () {
  openModal(modalShell('No Account', el('div', {}, [
    el('p', { text: 'To continue at least one account has to be present.' }),
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn', text: 'Cancel', onclick: closeModal }),
      el('button', { class: 'btn primary', text: 'Set up', onclick: () => { closeModal(); switchView('settings') } })
    ])
  ])))
}

let userChipListenerAttached = false

function skinHeadUrl (url, size) {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = size || 64
        c.height = size || 64
        const ctx = c.getContext('2d')
        const s = Math.min(img.width, img.height) >= 64 ? Math.max(1, img.width / 64) : 1
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(img, 8 * s, 8 * s, 8 * s, 8 * s, 0, 0, c.width, c.height)
        ctx.drawImage(img, 40 * s, 8 * s, 8 * s, 8 * s, 0, 0, c.width, c.height)
        resolve(c.toDataURL('image/png'))
      } catch { resolve(null) }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function loadChipAvatar (imgEl, account) {
  if (!account || account.type !== 'microsoft') return
  api.skins.profile(account.id).then(p => {
    const s = p && p.skins && p.skins[0]
    if (s && s.url) skinHeadUrl(s.url, 32).then(u => { if (u) imgEl.src = u })
  }).catch(() => {})
}

async function renderUserChip () {
  const chip = document.getElementById('online-user')
  if (!chip) return
  const list = await api.accounts.list()
  const sel = await api.accounts.selected()
  chip.innerHTML = ''
  const wrap = el('div', { class: 'user-chip-wrap' })
  const selAvatar = el('img', { class: 'user-chip-avatar', src: 'logo.png', alt: '' })
  const btn = el('button', { class: 'user-chip-btn', onclick: e => {
    e.stopPropagation()
    wrap.classList.toggle('open')
  } }, [
    el('span', { class: 'dot ' + (sel ? (sel.type === 'microsoft' ? 'ms' : 'offline') : 'none') }),
    selAvatar,
    el('span', { class: 'user-chip-name', text: sel ? sel.username : 'No account' })
  ])
  const menu = el('div', { class: 'user-chip-menu' })
  if (!list.length) {
    menu.appendChild(el('div', { class: 'user-chip-item muted', text: 'No accounts set up' }))
  }
  for (const acc of list) {
    const av = el('img', { class: 'user-chip-avatar', src: 'logo.png', alt: '' })
    loadChipAvatar(av, acc)
    menu.appendChild(el('button', { class: 'user-chip-item' + (sel && sel.id === acc.id ? ' selected' : ''), onclick: async () => {
      if (!sel || sel.id !== acc.id) await api.accounts.setSelected(acc.id)
      wrap.classList.remove('open')
      renderUserChip()
    } }, [
      av,
      el('span', { class: 'user-chip-item-name', text: acc.username }),
      el('span', { class: 'user-chip-item-type', text: acc.type === 'microsoft' ? 'Microsoft' : 'Offline' })
    ]))
  }
  if (sel && sel.type === 'microsoft') {
    menu.appendChild(el('button', { class: 'user-chip-item', onclick: () => {
      wrap.classList.remove('open')
      openSkinModal(sel)
    }, text: 'Skin & Cape' }))
  }
  menu.appendChild(el('button', { class: 'user-chip-item manage', onclick: () => {
    wrap.classList.remove('open')
    switchView('settings')
  }, text: 'Manage accounts' }))
  wrap.appendChild(btn)
  wrap.appendChild(menu)
  chip.appendChild(wrap)
  loadChipAvatar(selAvatar, sel)
  if (!userChipListenerAttached) {
    userChipListenerAttached = true
    document.addEventListener('click', e => {
      document.querySelectorAll('.user-chip-wrap.open').forEach(w => {
        if (!w.contains(e.target)) w.classList.remove('open')
      })
    })
  }
  renderHero()
}

/* ---------- onboarding wizard ---------- */

function runWizard () {
  const root = el('div', { class: 'wizard-root' })
  const box = el('div', { class: 'wizard' })
  const inner = el('div', { class: 'wizard-inner' })
  box.appendChild(inner)
  root.appendChild(box)
  document.body.appendChild(root)
  document.body.classList.add('no-scroll')

  function setStep (node) {
    inner.innerHTML = ''
    inner.appendChild(node)
  }

  function finish () {
    document.body.classList.remove('no-scroll')
    root.remove()
    api.config.set({ onboarded: true })
    renderUserChip()
  }

  function stepWelcome () {
    setStep(el('div', { class: 'wizard-step' }, [
      el('div', { class: 'wizard-icon', text: '\u2699' }),
      el('h2', { text: 'Hi, Welcome to Nightly Launcher' }),
      el('p', { class: 'wizard-sub', text: 'Set up an account to start playing Minecraft. You can skip this and do it later in Settings.' }),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn primary', text: 'Continue', onclick: stepAccount })
      ])
    ]))
  }

  function stepAccount () {
    setStep(el('div', { class: 'wizard-step' }, [
      el('h2', { text: 'How do you want to play?' }),
      el('div', { class: 'account-options' }, [
        el('button', { class: 'account-option', onclick: () => chooseMicrosoft() }, [
          el('div', { class: 'account-option-title', text: 'Microsoft Account' }),
          el('div', { class: 'account-option-sub', text: 'Use your real Minecraft profile with online play.' })
        ]),
        el('button', { class: 'account-option', onclick: () => chooseOffline() }, [
          el('div', { class: 'account-option-title', text: 'Offline Account' }),
          el('div', { class: 'account-option-sub', text: 'Play singleplayer with a username only.' })
        ])
      ]),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn', text: 'Set up later', onclick: finish })
      ])
    ]))
  }

  function stepDone () {
    setStep(el('div', { class: 'wizard-step' }, [
      el('div', { class: 'wizard-icon ok', text: '\u2713' }),
      el('h2', { text: 'Let\'s go mine and craft' }),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn primary', text: 'Continue to Launcher', onclick: finish })
      ])
    ]))
  }

  async function chooseMicrosoft () {
    try {
      await beginMicrosoftLogin()
      stepDone()
    } catch (e) {
      if (e && e.cancelled) { stepAccount(); return }
      toast(e.message, 'error')
      stepAccount()
    }
  }

  async function chooseOffline () {
    const name = await promptForUsername('Offline account')
    if (name === null) { stepAccount(); return }
    await api.accounts.addOffline(name)
    stepDone()
  }

  stepWelcome()
}

/* ---------- progress ---------- */

let activeJobId = null

function isCancelled (e) {
  return !!(e && (e.cancelled || /cancelled/i.test(e.message || '')))
}

function showProgress (title, sub, opts) {
  const root = document.getElementById('progress-root')
  const jobId = opts && opts.jobId
  root.innerHTML = ''
  root.classList.add('open')
  const children = [
    el('div', { class: 'progress-title', text: title }),
    el('div', { class: 'progress-sub', text: sub || 'Preparing...' }),
    el('div', { class: 'progress-track' }, [el('div', { class: 'progress-fill', id: 'prog-fill' })])
  ]
  if (jobId) {
    activeJobId = jobId
    children.push(el('div', { class: 'progress-actions' }, [
      el('button', { class: 'btn progress-cancel', text: 'Cancel', onclick: () => cancelActiveInstall() })
    ]))
  }
  root.appendChild(el('div', { class: 'progress-box' }, children))
}

async function cancelActiveInstall () {
  const jobId = activeJobId
  if (!jobId) return
  activeJobId = null
  const btn = document.querySelector('#progress-root .progress-cancel')
  if (btn) btn.disabled = true
  setProgress(null, 'Cancelling...')
  try { await api.install.cancel(jobId) } catch {}
}

function setProgress (frac, sub) {
  const fill = document.getElementById('prog-fill')
  if (fill) fill.style.width = Math.round((frac || 0) * 100) + '%'
  if (sub) {
    const node = document.getElementById('progress-root').querySelector('.progress-sub')
    if (node) node.textContent = sub
  }
}

function hideProgress () {
  document.getElementById('progress-root').classList.remove('open')
  document.getElementById('progress-root').innerHTML = ''
}

let activeProgressTitle = ''
api.onImportProgress(p => {
  if (!p) return
  if (p.phase === 'loader') { setProgress(0, p.message) }
  else if (p.phase === 'libraries') { setProgress(p.done / (p.total || 1), 'Libraries ' + p.done + '/' + (p.total || 0)) }
  else if (p.phase === 'assets') { setProgress(p.done / (p.total || 1), 'Assets ' + p.done + '/' + (p.total || 0)) }
  else if (p.phase === 'mods') { setProgress(p.done / (p.total || 1), 'Mods ' + p.done + '/' + (p.total || 0)) }
  else if (p.phase === 'mods-start') { setProgress(0, p.message) }
  else if (p.phase === 'download') { setProgress(p.percent || 0, 'Downloading... ' + Math.round((p.percent || 0) * 100) + '%') }
  else if (p.phase === 'warn') { console.warn(p.message) }
})

/* ---------- state ---------- */

const state = {
  view: 'instances',
  config: null,
  instances: [],
  selectedId: null,
  browse: { tab: 'modrinth', query: '', page: 0, results: [] }
}

/* ---------- navigation ---------- */

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view))
})

function switchView (name) {
  state.view = name
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name))
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name))
  if (name === 'instances') renderInstances()
  else if (name === 'browse') renderBrowse()
  else if (name === 'settings') renderSettings()
}

/* ---------- icons ---------- */

const LOADER_ART = {
  vanilla: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1a1a2e"/><rect x="10" y="22" width="44" height="20" rx="4" fill="#4cc9f0"/></svg>',
  fabric: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1a1a2e"/><path d="M14 18l14 6 6 16 16-4-10 8 4 6-14-4-10 6 4-8-10-10z" fill="#d89a6e"/></svg>',
  quilt: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1a1a2e"/><circle cx="32" cy="32" r="14" fill="#e7a83e"/></svg>',
  forge: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1a1a2e"/><path d="M18 12v18h10v22h8V30h10V12z" fill="#8a7cf0"/></svg>',
  neoforge: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1a1a2e"/><path d="M14 14h12l6 12 6-12h12L32 50z" fill="#f0688a"/></svg>'
}

function iconFor (loader, icon) {
  if (icon) return icon
  return 'data:image/svg+xml;base64,' + btoa(LOADER_ART[loader] || LOADER_ART.vanilla)
}

/* ---------- instances ---------- */

async function renderInstances () {
  state.instances = await api.instances.list()
  const grid = document.getElementById('instance-grid')
  grid.innerHTML = ''
  if (!state.instances.length) {
    grid.appendChild(el('div', { class: 'empty-state' }, [
      el('div', { class: 'big', text: '\u2737' }),
      el('p', { text: 'No instances yet. Create one or import a modpack.' })
    ]))
  }
  for (const inst of state.instances) {
    const running = await api.launch.running(inst.id)
    const card = el('div', { class: 'card' + (state.selectedId === inst.id ? ' selected' : '') }, [
      el('div', { class: 'card-top' }, [
        el('img', { class: 'card-icon', src: iconFor(inst.loader, inst.icon), alt: '' }),
        el('div', {}, [
          el('div', { class: 'card-title', text: inst.name }),
          el('div', { class: 'card-sub', text: (inst.loader === 'vanilla' ? '' : inst.loader + ' ') + (inst.mcVersion || '') })
        ])
      ]),
      el('div', { class: 'badges' }, [
        el('span', { class: 'badge loader', text: inst.loader }),
        el('span', { class: 'badge', text: 'last: ' + fmtDate(inst.lastPlayed) }),
        inst.playtimeMs > 0 && el('span', { class: 'badge', text: '\u25B6 ' + fmtPlaytime(inst.playtimeMs) }),
        running && el('span', { class: 'badge green', text: 'RUNNING' })
      ]),
      el('div', { class: 'card-actions' }, [
        el('button', { class: 'btn primary small', text: running ? 'Stop' : 'Play',
          onclick: () => running ? stopInstance(inst) : launchInstance(inst) }),
        el('button', { class: 'btn small', text: 'Edit', onclick: () => editInstance(inst) }),
        el('button', { class: 'btn small', text: 'Copy', onclick: () => duplicateInstance(inst) }),
        el('button', { class: 'btn danger small', text: 'Del', onclick: () => removeInstance(inst) })
      ])
    ])
    card.addEventListener('click', e => {
      if (e.target.closest('button')) return
      selectInstance(inst.id)
    })
    grid.appendChild(card)
  }
  renderHero()
}

function selectInstance (id) {
  state.selectedId = state.selectedId === id ? null : id
  renderInstances()
}

let heroRenderSeq = 0

function makeOfflineHead (username) {
  let h = 0
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) >>> 0
  const rand = () => { h = (h * 1664525 + 1013904223) >>> 0; return h / 4294967296 }
  const palettes = [
    ['#5e4423', '#e0ac69', '#3a2a18'],
    ['#3a2a18', '#f5d0a9', '#2a1a0f'],
    ['#2b1d0e', '#c98a4b', '#1a120a']
  ]
  const [hair, skin, shadow] = palettes[Math.floor(rand() * palettes.length)]
  const px = 10
  const r = (x, y, c) => `<rect x="${x * px}" y="${y * px}" width="${px}" height="${px}" fill="${c}"/>`
  let out = ''
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (y < 2) out += r(x, y, hair)
      else if (y < 7) out += r(x, y, skin)
      else out += r(x, y, shadow)
    }
  }
  const eyes = rand() > 0.5 ? 2 : 1
  for (const ex of [eyes, eyes + 2]) out += r(ex, 3, shadow) + r(ex + 1, 3, shadow)
  out += r(3, 5, shadow) + r(4, 5, shadow)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">${out}</svg>`
  return 'data:image/svg+xml;base64,' + btoa(svg)
}

async function renderHero () {
  const hero = document.getElementById('instances-hero')
  if (!hero) return
  const seq = ++heroRenderSeq
  const charEl = document.getElementById('hero-character')
  const actions = document.getElementById('hero-actions')
  const meta = document.getElementById('hero-meta')
  const title = document.getElementById('hero-title')
  const sub = document.getElementById('hero-sub')
  if (!charEl || !actions || !meta || !title || !sub) return

  if (seq !== heroRenderSeq) return
  let insts = []
  try { insts = await api.instances.list() } catch {}
  if (seq !== heroRenderSeq) return

  const sel = await api.accounts.selected()
  let account = null
  if (sel) {
    try {
      const list = await api.accounts.list()
      account = list.find(a => a.id === sel.id) || null
    } catch {}
  }
  if (seq !== heroRenderSeq) return

  actions.innerHTML = ''
  meta.innerHTML = ''

  const signedPill = el('span', { class: 'hero-pill' }, [
    el('b', { text: (account ? account.username : 'No account') + ' ' }),
    el('span', { text: 'signed in' })
  ])

  const selected = state.selectedId ? insts.find(i => i.id === state.selectedId) || null : null

  if (selected) {
    let running = false
    try { running = await api.launch.running(selected.id) } catch {}
    if (seq !== heroRenderSeq) return
    const label = selected.loader === 'vanilla' ? 'Vanilla' : selected.loader.charAt(0).toUpperCase() + selected.loader.slice(1)
    const when = selected.lastPlayed ? 'Last played ' + fmtDate(selected.lastPlayed) : 'Never played'

    title.textContent = selected.name
    sub.textContent = running ? 'This instance is running right now.' : label + ' ' + (selected.mcVersion || '') + ' \u00B7 ' + when

    actions.appendChild(el('button', {
      class: 'btn primary lg',
      text: running ? '\u25A0 Stop' : '\u25B6 Play',
      onclick: () => running ? stopInstance(selected) : launchInstance(selected)
    }))
    if (!running) {
      actions.appendChild(el('button', { class: 'btn lg', text: 'Edit', onclick: () => editInstance(selected) }))
    }
    meta.appendChild(el('span', { class: 'hero-pill' }, [
      el('b', { text: insts.length + ' ' }),
      el('span', { text: insts.length === 1 ? 'instance' : 'instances' })
    ]))
    if (selected.playtimeMs > 0) {
      meta.appendChild(el('span', { class: 'hero-pill' }, [
        el('b', { text: fmtPlaytime(selected.playtimeMs) + ' ' }),
        el('span', { text: 'played' })
      ]))
    }
    meta.appendChild(signedPill)
  } else {
    title.textContent = "Let's create an instance"
    sub.textContent = 'Create a new instance or import a modpack to get started.'
    actions.appendChild(el('button', { class: 'btn primary lg', text: 'Create', onclick: () => newInstance() }))
    actions.appendChild(el('button', { class: 'btn lg', text: 'Import Modpack', onclick: () => importFromFile() }))
    meta.appendChild(el('span', { class: 'hero-pill' }, [
      el('b', { text: insts.length + ' ' }),
      el('span', { text: insts.length === 1 ? 'instance' : 'instances' })
    ]))
    meta.appendChild(signedPill)
  }

  const clearCharacter = () => {
    if (charEl.__viewer) { try { charEl.__viewer.dispose() } catch {} }
    charEl.__viewer = null
    charEl.innerHTML = ''
    charEl.classList.remove('has-character')
  }

  let viewer = null
  if (account && account.type === 'microsoft') {
    try {
      const prof = await api.skins.profile(account.id)
      if (seq !== heroRenderSeq) return
      const skin = prof.skins && prof.skins[0]
      if (skin && skin.url) {
        const cape = prof.capes && prof.capes.find(c => c.state === 'ACTIVE')
        viewer = { skin: skin.url, cape: cape && cape.url, slim: skin.variant === 'SLIM' }
      }
    } catch {}
  } else if (account && account.type === 'offline') {
    try {
      const res = await api.skins.byUsername(account.username)
      if (seq !== heroRenderSeq) return
      if (res && res.skin) viewer = { skin: res.skin, cape: res.cape, slim: res.slim }
    } catch {}
  }
  if (seq !== heroRenderSeq) return
  clearCharacter()
  if (viewer && viewer.skin) {
    const canvas = el('canvas', { class: 'hero-skin-canvas' })
    const v = new skinview3d.SkinViewer({
      canvas,
      width: 170,
      height: 220,
      skin: viewer.skin,
      model: viewer.slim ? 'slim' : 'default'
    })
    v.autoRotate = false
    v.playerObject.rotation.y = -40 * Math.PI / 180
    const camDist = v.camera.position.length()
    v.camera.position.set(0, 0, 1).normalize().multiplyScalar(camDist)
    v.camera.lookAt(0, 0, 0)
    if (viewer.cape) v.loadCape(viewer.cape)
    charEl.__viewer = v
    charEl.appendChild(canvas)
    charEl.classList.add('has-character')
  } else {
    const head = account && account.type === 'offline' ? makeOfflineHead(account.username) : null
    charEl.appendChild(el('div', { class: 'hero-character-empty' }, [
      head ? el('img', { src: head, alt: '', class: 'hero-head' }) : el('img', { src: 'logo.png', alt: '', class: 'hero-logo' }),
      el('div', { class: 'hero-character-name', text: account ? account.username : 'No account' }),
      el('div', { class: 'hero-character-type', text: account ? (account.type === 'microsoft' ? 'Microsoft' : 'Offline') : 'Guest' })
    ]))
  }
}

async function stopInstance (inst) {
  await api.launch.stop(inst.id)
  toast('Stopping ' + inst.name + '...')
  setTimeout(renderInstances, 600)
}

async function removeInstance (inst) {
  if (!confirm('Delete "' + inst.name + '" and all its files?')) return
  await api.instances.remove(inst.id)
  if (state.selectedId === inst.id) state.selectedId = null
  toast('Deleted ' + inst.name, 'success')
  renderInstances()
}

async function duplicateInstance (inst) {
  await api.instances.duplicate(inst.id)
  toast('Duplicated ' + inst.name, 'success')
  renderInstances()
}

/* ---------- create / edit ---------- */

function loaderLabel (loader) {
  return { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' }[loader] || loader
}

const FILTER_KEYS = [['releases', 'Releases'], ['snapshots', 'Snapshots'], ['betas', 'Betas'], ['alphas', 'Alphas'], ['experiments', 'Experiments']]

function instanceForm (inst) {
  const nameInput = el('input', { value: inst ? inst.name : '', placeholder: 'Instance name' })
  let chosenIcon = inst ? (inst.icon || '') : ''
  const iconPreview = el('img', { class: 'icon-preview', src: iconFor(inst ? inst.loader : 'vanilla', chosenIcon), alt: '' })
  const iconRow = el('div', { class: 'icon-row' }, [
    iconPreview,
    el('button', { class: 'btn small', text: 'Choose icon', onclick: async () => {
      try {
        const r = await api.instances.chooseIcon()
        if (r && r.dataUrl) { chosenIcon = r.dataUrl; iconPreview.src = r.dataUrl }
      } catch (e) { toast(e.message, 'error') }
    } }),
    el('button', { class: 'btn small', text: 'Reset icon', onclick: () => {
      chosenIcon = ''
      iconPreview.src = iconFor(loaderSel.value, '')
    } })
  ])
  const loaderSel = el('select', {})
  for (const [k, label] of [['vanilla', 'Vanilla'], ['fabric', 'Fabric'], ['quilt', 'Quilt'], ['forge', 'Forge'], ['neoforge', 'NeoForge']]) {
    loaderSel.appendChild(el('option', { value: k, text: label }))
  }
  if (inst) loaderSel.value = inst.loader

  const mcSel = el('select', {})
  const lvSel = el('select', {})
  const lvStatus = el('div', { class: 'hint', text: ' ' })

  const currentFilters = Object.assign({}, state.config.filters)
  const filterBoxes = {}
  const filtersWrap = el('div', { class: 'filter-chips' })
  for (const [key, label] of FILTER_KEYS) {
    const cb = el('input', { type: 'checkbox', checked: !!currentFilters[key] })
    filterBoxes[key] = cb
    cb.addEventListener('change', () => {
      currentFilters[key] = cb.checked
      fillMc()
    })
    filtersWrap.appendChild(el('label', { class: 'filter-chip' }, [cb, el('span', { text: label })]))
  }

  let supported = null
  let supportedFor = ''
  let supportedLoading = null

  async function loadSupported () {
    const loader = loaderSel.value
    if (loader === 'vanilla') { supported = null; supportedFor = ''; supportedLoading = null; return }
    if (supportedFor === loader && supported) { await fillMc(); return }
    if (supportedLoading) return supportedLoading
    supportedLoading = (async () => {
      try {
        supported = await api.loaders.supported(loader)
      } catch (e) {
        supported = []
      }
      supportedFor = loader
      supportedLoading = null
      await fillMc()
    })()
    return supportedLoading
  }

  async function fillMc () {
    mcSel.disabled = true
    const loader = loaderSel.value
    if (!FILTER_KEYS.some(([k]) => currentFilters[k])) {
      currentFilters.releases = true
      const rb = filterBoxes.releases
      if (rb) rb.checked = true
    }
    let versions = []
    try {
      versions = await api.versions.list(currentFilters)
    } catch (e) {
      versions = []
    }
    versions.sort((a, b) => (a.releaseTime < b.releaseTime ? 1 : -1))
    if (supported) {
      const set = new Set(supported)
      versions = versions.filter(v => set.has(v.id))
    }
    const current = inst ? inst.mcVersion : null
    mcSel.innerHTML = ''
    if (!versions.length) {
      const why = loader === 'vanilla' ? '' : ' for ' + loaderLabel(loader)
      mcSel.appendChild(el('option', { value: '', text: 'No versions available' + why }))
    } else {
      for (const v of versions) {
        mcSel.appendChild(el('option', { value: v.id, text: v.id + (v.category !== 'releases' ? ' (' + v.category + ')' : '') }))
      }
      if (current) {
        if (!versions.some(v => v.id === current)) mcSel.appendChild(el('option', { value: current, text: current + ' (saved)' }))
        mcSel.value = current
      }
    }
    mcSel.disabled = false
    await refreshLoader()
  }

  async function refreshLoader () {
    const loader = loaderSel.value
    const mc = mcSel.value
    lvSel.innerHTML = ''
    lvStatus.textContent = ' '
    if (loader === 'vanilla') {
      lvSel.disabled = true
      lvSel.appendChild(el('option', { value: '', text: 'Latest' }))
      return
    }
    if (!mc) {
      lvSel.disabled = true
      lvSel.appendChild(el('option', { value: '', text: 'Pick a Minecraft version first' }))
      return
    }
    lvSel.disabled = true
    lvStatus.textContent = 'Loading ' + loaderLabel(loader) + ' versions...'
    try {
      const versions = await api.loaders.list(loader, mc)
      if (!versions.length) {
        lvSel.disabled = true
        lvSel.appendChild(el('option', { value: '', text: 'No ' + loaderLabel(loader) + ' versions for ' + mc }))
        lvStatus.textContent = 'No ' + loaderLabel(loader) + ' builds support ' + mc + '.'
      } else {
        const current = inst ? inst.loaderVersion : ''
        for (const v of versions) lvSel.appendChild(el('option', { value: v.loader, text: v.loader }))
        if (current) {
          if (!versions.some(v => v.loader === current)) lvSel.appendChild(el('option', { value: current, text: current + ' (saved)' }))
          lvSel.value = current
        }
        if (!lvSel.value && versions.length) lvSel.value = versions[0].loader
        lvStatus.textContent = versions.length + ' build' + (versions.length === 1 ? '' : 's') + ' available'
      }
    } catch (e) {
      lvSel.disabled = true
      lvSel.appendChild(el('option', { value: '', text: 'Failed to load versions' }))
      lvStatus.textContent = e.message
    }
    lvSel.disabled = false
  }

  loaderSel.addEventListener('change', () => { loadSupported(); fillMc() })
  mcSel.addEventListener('change', () => { refreshLoader(); if (!javaUserSet) autoSetJava() })

  const useGlobalMem = el('input', { type: 'checkbox', checked: inst ? !inst.customMemory : true })
  const maxMem = el('input', { type: 'number', value: (inst && inst.customMemory && inst.maxMemory) || state.config.maxMemory || 4096, min: 512, step: 256, disabled: inst ? !inst.customMemory : true })
  const minMem = el('input', { type: 'number', value: (inst && inst.customMemory && inst.minMemory) || state.config.minMemory || 512, min: 256, step: 128, disabled: inst ? !inst.customMemory : true })
  useGlobalMem.addEventListener('change', () => {
    maxMem.disabled = useGlobalMem.checked
    minMem.disabled = useGlobalMem.checked
  })
  const jvmArgs = el('input', { value: (inst && inst.jvmArgs) || '', placeholder: '-XX:+UseG1GC' })
  const width = el('input', { type: 'number', value: (inst && inst.resolution && inst.resolution.width) || state.config.resolution.width || 854 })
  const height = el('input', { type: 'number', value: (inst && inst.resolution && inst.resolution.height) || state.config.resolution.height || 480 })

  const javaSel = el('select', {})
  const javaHint = el('div', { class: 'hint', text: ' ' })
  const javaDetectBtn = el('button', { class: 'btn small', text: 'Detect', onclick: () => loadJavaOptions() })
  const javaDlBtn = el('button', { class: 'btn small', text: 'Download', onclick: () => openDownloadJava() })
  let javaUserSet = false
  let detectedJava = []

  function updateJavaHint () {
    if (javaUserSet) {
      javaHint.textContent = javaSel.value ? 'Using this Java for this instance.' : 'Auto-detect at launch.'
    } else if (state.config && state.config.disableAutoJava) {
      javaHint.textContent = 'Auto Java selection is disabled in Settings.'
    }
  }

  function autoSetJava () {
    if (state.config && state.config.disableAutoJava) return
    if (!mcSel.value) { javaHint.textContent = ''; return }
    const req = requiredJavaMajor(mcSel.value)
    const cand = detectedJava.filter(j => (j.version || 0) >= req).sort((a, b) => (a.version || 0) - (b.version || 0))
    if (cand.length) {
      javaSel.value = cand[0].path
      javaHint.textContent = 'Auto-selected Java ' + cand[0].version + ' for ' + mcSel.value + ' (needs ' + req + '+).'
    } else if (detectedJava.length) {
      javaSel.value = ''
      javaHint.textContent = 'No installed Java is new enough for ' + mcSel.value + ' (needs Java ' + req + '+). Download one or pick another.'
    }
  }

  async function loadJavaOptions () {
    let found = []
    try { found = await api.java.detect() } catch {}
    detectedJava = found || []
    javaSel.innerHTML = ''
    javaSel.appendChild(el('option', { value: '', text: 'Auto-detect' }))
    for (const j of detectedJava) javaSel.appendChild(el('option', { value: j.path, text: shortJavaLabel(j) }))
    const saved = inst ? inst.javaPath : ''
    if (saved) {
      if (!detectedJava.some(j => j.path === saved)) javaSel.appendChild(el('option', { value: saved, text: shortJavaLabel({ path: saved }) }))
      javaSel.value = saved
      javaUserSet = true
    } else if (state.config && state.config.javaPath) {
      javaSel.appendChild(el('option', { value: state.config.javaPath, text: 'Global \u00b7 ' + shortJavaLabel({ path: state.config.javaPath }) }))
      javaSel.value = state.config.javaPath
      javaUserSet = true
    }
    if (!javaUserSet) autoSetJava()
    updateJavaHint()
  }

  javaSel.addEventListener('change', () => { javaUserSet = true; updateJavaHint() })

  const body = el('div', {}, [
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'form-field full' }, [el('label', { text: 'Name' }), nameInput]),
      el('div', { class: 'form-field full' }, [el('label', { text: 'Icon' }), iconRow]),
      el('div', { class: 'form-field' }, [el('label', { text: 'Loader' }), loaderSel]),
      el('div', { class: 'form-field' }, [el('label', { text: 'Minecraft version' }), mcSel]),
      el('div', { class: 'form-field' }, [el('label', { text: 'Loader version' }), lvSel, lvStatus]),
      el('div', { class: 'form-field full' }, [
        el('label', { text: 'Version filters' }),
        filtersWrap
      ]),
      el('div', { class: 'form-field full' }, [
        el('label', { class: 'inline' }, [useGlobalMem, ' Use global memory (Settings)'])
      ]),
      el('div', { class: 'form-field' }, [el('label', { text: 'Max memory (MB)' }), maxMem]),
      el('div', { class: 'form-field' }, [el('label', { text: 'Min memory (MB)' }), minMem]),
      el('div', { class: 'form-field full' }, [el('label', { text: 'JVM arguments' }), jvmArgs]),
      el('div', { class: 'form-field' }, [el('label', { text: 'Width' }), width]),
      el('div', { class: 'form-field' }, [el('label', { text: 'Height' }), height]),
      el('div', { class: 'form-field full' }, [
        el('label', { text: 'Java (optional)' }),
        el('div', { class: 'search-row' }, [javaSel, javaDetectBtn, javaDlBtn]),
        javaHint
      ])
    ])
  ])
  fillMc().finally(loadJavaOptions)
  return {
    body,
    get: () => {
      const loader = loaderSel.value
      const mc = mcSel.value
      const loaderVersion = loader === 'vanilla' ? '' : lvSel.value
      if (!mc) throw new Error('No Minecraft version available for ' + loaderLabel(loader))
      if (loader !== 'vanilla' && !loaderVersion) throw new Error('No ' + loaderLabel(loader) + ' build available for ' + mc)
      const customMemory = !useGlobalMem.checked
      return {
        name: nameInput.value.trim() || 'Untitled',
        loader,
        mcVersion: mc,
        loaderVersion,
        icon: chosenIcon,
        maxMemory: customMemory ? (parseInt(maxMem.value, 10) || 4096) : 0,
        minMemory: customMemory ? (parseInt(minMem.value, 10) || 512) : 0,
        customMemory,
        jvmArgs: jvmArgs.value.trim(),
        resolution: { width: parseInt(width.value, 10) || 854, height: parseInt(height.value, 10) || 480 },
        javaPath: javaSel.value.trim(),
        filters: Object.assign({}, currentFilters)
      }
    }
  }
}

async function newInstance () {
  const f = instanceForm(null)
  openModal(modalShell('Create Instance', el('div', {}, [
    f.body,
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn', text: 'Cancel', onclick: closeModal }),
      el('button', { class: 'btn primary', text: 'Create & Install', onclick: () => saveInstance(f.get()) })
    ])
  ])))
}

async function editInstance (inst) {
  const f = instanceForm(inst)
  openModal(modalShell('Edit ' + inst.name, el('div', {}, [
    f.body,
    el('div', { class: 'instance-tools' }, [
      el('button', { class: 'btn small', text: '\u25C9 Logs', onclick: () => openLogsModal(inst) }),
      el('button', { class: 'btn small', text: '\u25E7 Mods', onclick: () => openModsModal(inst) })
    ]),
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn', text: 'Cancel', onclick: closeModal }),
      el('button', { class: 'btn primary', text: 'Save', onclick: () => saveInstance(f.get(), inst.id) })
    ])
  ])))
}

async function saveInstance (data, id) {
  closeModal()
  showProgress(id ? 'Updating ' + data.name : 'Installing ' + data.name)
  try {
    if (!data.mcVersion) throw new Error('Pick a Minecraft version')
    let inst
    if (id) {
      inst = await api.instances.update(id, data)
    } else {
      inst = await api.instances.create(data)
    }
    await api.install.loader(data.loader, data.mcVersion, data.loaderVersion || '', inst.id)
    state.config.filters = Object.assign({}, data.filters || state.config.filters)
    await api.config.set({ filters: state.config.filters })
    hideProgress()
    toast('Instance ' + data.name + ' ready', 'success')
    renderInstances()
  } catch (e) {
    hideProgress()
    toast('Install failed: ' + e.message, 'error')
  }
}

/* ---------- logs & mods ---------- */

async function openLogsModal (inst) {
  const pre = el('pre', { class: 'logs-view' })
  const status = el('div', { class: 'hint', text: ' ' })
  const cached = { game: '', console: '' }
  const lastLen = { game: -1, console: -1 }
  let current = 'game'

  function renderCurrent () {
    const c = current === 'game' ? cached.game : cached.console
    pre.textContent = c || (current === 'game' ? 'No game log yet. Launch the instance to see logs here.' : 'No launcher log yet.')
    pre.scrollTop = pre.scrollHeight
  }

  function makeTab (key, label) {
    return el('button', { class: 'tab' + (current === key ? ' active' : ''), text: label, onclick: () => {
      current = key
      gameTab.classList.toggle('active', current === 'game')
      consoleTab.classList.toggle('active', current === 'console')
      renderCurrent()
    } })
  }
  const gameTab = makeTab('game', 'Game log')
  const consoleTab = makeTab('console', 'Launcher log')
  const tabWrap = el('div', { class: 'tabs' }, [gameTab, consoleTab])

  async function poll () {
    if (!pre.isConnected) return false
    try {
      const data = await api.logs.read(inst.id)
      if (data.game.content.length !== lastLen.game) {
        lastLen.game = data.game.content.length
        cached.game = data.game.content
        if (current === 'game') renderCurrent()
      }
      if (data.console.content.length !== lastLen.console) {
        lastLen.console = data.console.content.length
        cached.console = data.console.content
        if (current === 'console') renderCurrent()
      }
      const running = await api.launch.running(inst.id)
      status.textContent = running ? '\u25CF Live — ' + inst.name + ' is running' : 'Instance is not running — showing the last session.'
      status.classList.toggle('live', running)
    } catch {}
    return true
  }

  const timer = setInterval(() => { if (!poll()) clearInterval(timer) }, 1200)
  openModal(modalShell('Logs \u2014 ' + inst.name, el('div', {}, [
    tabWrap,
    el('div', { style: 'height:10px' }),
    pre,
    status
  ])))
  poll()
}

async function openModsModal (inst) {
  const installedWrap = el('div', { class: 'mods-installed' })
  const sourcesWrap = el('div', { class: 'mods-sources' })
  const hint = el('div', { class: 'hint', text: ' ' })

  let installedFiles = new Set()
  let installedSlugs = new Set()
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  function isInstalledByName (name, slug) {
    if (slug && installedSlugs.has(slug)) return true
    const n = norm(name)
    if (n.length < 4) return false
    for (const f of installedFiles) {
      const fn = norm(f)
      if (!fn) continue
      if (fn.includes(n)) return true
      if (slug) {
        const sl = norm(slug)
        if (sl.length >= 3 && fn.includes(sl)) return true
      }
      if (fn.length >= 6 && n.includes(fn)) return true
    }
    return false
  }
  function isInstalledFile (file) {
    const fn = norm(file)
    if (!fn) return false
    for (const f of installedFiles) if (norm(f) === fn) return true
    return false
  }

  function renderInstalledRows (mods) {
    installedWrap.innerHTML = ''
    if (!mods || !mods.length) {
      installedWrap.appendChild(el('div', { class: 'mod-row empty', text: 'No mods installed yet.' }))
      return
    }
    for (const m of mods) {
      installedWrap.appendChild(el('div', { class: 'mod-row' }, [
        el('div', { class: 'mod-inst-icon-wrap' }, [
          m.meta && m.meta.icon
            ? el('img', { class: 'mod-inst-icon', src: m.meta.icon, alt: '', onerror: e => { e.target.style.display = 'none' } })
            : el('div', { class: 'mod-inst-icon placeholder' })
        ]),
        el('div', { class: 'mod-info' }, [
          el('div', { class: 'mod-name', text: (m.meta && m.meta.name) ? m.meta.name : m.filename }),
          el('div', { class: 'mod-meta', text: (m.meta && m.meta.slug ? m.meta.slug + ' \u00B7 ' : m.filename + ' \u00B7 ') + fmtBytes(m.size) + ' \u00B7 ' + fmtDate(m.mtime) })
        ]),
        el('button', { class: 'btn danger small', text: 'Remove', onclick: async () => {
          try {
            await api.mods.remove(inst.id, m.filename)
            renderInstalled()
          } catch (e) { toast(e.message, 'error') }
        } })
      ]))
    }
  }

  async function renderInstalled () {
    installedWrap.innerHTML = ''
    try {
      const mods = await api.mods.list(inst.id)
      installedFiles = new Set(mods.map(m => m.filename))
      installedSlugs = new Set(mods.map(m => m.meta && m.meta.slug).filter(Boolean))
      renderInstalledRows(mods)
      api.mods.resolveIcons(inst.id).then(updated => {
        const list = updated || []
        installedFiles = new Set(list.map(m => m.filename))
        installedSlugs = new Set(list.map(m => m.meta && m.meta.slug).filter(Boolean))
        renderInstalledRows(list)
        refreshInstalledState()
      }).catch(() => {})
    } catch (e) {
      installedWrap.appendChild(el('div', { class: 'hint', text: 'Failed to load mods: ' + e.message }))
    }
  }

  async function installFlow (run) {
    const jobId = 'mod-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)
    hint.textContent = 'Installing...'
    try {
      showProgress('Installing mod', inst.name, { jobId })
      const res = await run(jobId)
      activeJobId = null
      hideProgress()
      hint.textContent = res ? 'Installed ' + res.filename : 'Installed.'
      await renderInstalled()
      refreshInstalledState()
    } catch (e) {
      activeJobId = null
      hideProgress()
      if (isCancelled(e)) {
        hint.textContent = 'Install cancelled.'
        toast('Install cancelled.', 'error')
        return
      }
      hint.textContent = 'Install failed: ' + e.message
      toast(e.message, 'error')
    }
  }

  function refreshInstalledState () {
    for (const card of document.querySelectorAll('.mod-card')) {
      const name = card.dataset.name
      const slug = card.dataset.slug
      if (!name) continue
      const inst = isInstalledByName(name, slug)
      card.classList.toggle('installed', inst)
      const btn = card.querySelector('.mod-card-action .install-action')
      if (btn) {
        btn.disabled = inst
        btn.classList.toggle('installed', inst)
        btn.textContent = inst ? 'Installed' : 'Install'
      }
      const iconWrap = card.querySelector('.mod-card-icon-wrap')
      let badge = iconWrap && iconWrap.querySelector('.installed-badge')
      if (inst && iconWrap && !badge) iconWrap.appendChild(el('span', { class: 'installed-badge', title: 'Installed', text: '\u2713' }))
      else if (!inst && badge) badge.remove()
    }
  }

  function makeModCard (r, fetchVersions, box) {
    const name = r.name || r.title || 'Unknown'
    const slug = r.slug || ''
    const installed = isInstalledByName(name, slug)
    const iconWrap = el('div', { class: 'mod-card-icon-wrap' }, [
      el('img', { class: 'mod-card-icon', src: r.icon || '', alt: '', onerror: e => { e.target.style.display = 'none' } })
    ])
    const actionWrap = el('div', { class: 'mod-card-action' })
    const btn = el('button', {
      class: 'btn small install-action' + (installed ? ' installed' : ''),
      disabled: installed,
      text: installed ? 'Installed' : 'Install',
      onclick: async () => {
        try {
          const versions = await fetchVersions(r)
          if (!versions || !versions.length) {
            toast('No versions match ' + inst.loader + ' ' + (inst.mcVersion || 'this MC version') + '.', 'error')
            return
          }
          pickVersion(r, versions)
        } catch (e) { toast(e.message, 'error') }
      }
    })
    if (installed) iconWrap.appendChild(el('span', { class: 'installed-badge', title: 'Installed', text: '\u2713' }))
    actionWrap.appendChild(btn)
    const infoChildren = [el('div', { class: 'mod-card-name', text: name })]
    if (r.author || r.dev) infoChildren.push(el('div', { class: 'mod-card-dev', text: r.author || r.dev }))
    if (r.description || r.summary) infoChildren.push(el('div', { class: 'mod-card-desc', text: String(r.description || r.summary).slice(0, 140) }))
    box.appendChild(el('div', { class: 'mod-card' + (installed ? ' installed' : ''), attrs: { 'data-name': name, 'data-slug': slug } }, [
      iconWrap,
      el('div', { class: 'mod-card-info' }, infoChildren),
      actionWrap
    ]))
  }

  function renderResults (results, fetchVersions, box, append) {
    if (!append) box.innerHTML = ''
    if (!results.length) {
      if (!append) box.appendChild(el('div', { class: 'hint', text: 'No results. Try a different search.' }))
      return
    }
    for (const r of results) makeModCard(r, fetchVersions, box)
  }

  function pickVersion (r, versions) {
    const root = document.getElementById('modal-root')
    const overlay = el('div', { class: 'inline-prompt-backdrop' })
    const listWrap = el('div', { class: 'version-picker-list' })
    const sorted = versions.slice().sort((a, b) => {
      const da = new Date(a.published || a.date_published || a.fileDate || 0).getTime()
      const db = new Date(b.published || b.date_published || b.fileDate || 0).getTime()
      if (da && db) return db - da
      return 0
    })
    let selectedId = null
    const items = sorted.map(v => {
      const file = v.fileName || v.filename || ''
      const fileInst = isInstalledFile(file)
      const mcList = v.game_versions || v.gameVersions || []
      const meta = [mcList.slice(-2).join(', '), fmtBytes(v.fileLength || v.downloads), v.releaseType || ''].filter(Boolean).join(' \u00B7 ')
      const it = el('button', {
        class: 'version-pick-item' + (fileInst ? ' already' : ''),
        attrs: { 'data-id': v.id },
        disabled: fileInst,
        onclick: () => select(v.id)
      }, [
        el('span', { class: 'vp-name', text: (v.name || v.version_number || v.displayName || v.fileName || 'Version') + (fileInst ? ' \u2014 already installed' : '') }),
        el('span', { class: 'vp-meta', text: meta })
      ])
      return it
    })
    function select (id) {
      selectedId = id
      items.forEach(i => i.classList.toggle('selected', !i.disabled && i.dataset.id === String(id)))
    }
    const auto = sorted.find(v => !isInstalledFile(v.fileName || v.filename || '')) || sorted[0]
    if (auto) select(auto.id)
    const installBtn = el('button', {
      class: 'btn primary',
      text: 'Install',
      onclick: () => {
        const v = sorted.find(x => x.id === selectedId) || sorted[0]
        items.forEach(i => { i.disabled = true })
        cancelBtn.disabled = true
        installBtn.disabled = true
        overlay.querySelector('.inline-prompt-box').replaceChildren(
          el('div', { class: 'version-picker-installing' }, [
            el('span', { class: 'spinner' }),
            el('div', { class: 'version-picker-sub', text: 'Installing ' + (r.name || r.title) + '...' })
          ])
        )
        installFlow(jobId => v.install(jobId)).then(() => overlay.remove())
      }
    })
    const cancelBtn = el('button', { class: 'btn', text: 'Cancel', onclick: () => overlay.remove() })
    overlay.appendChild(el('div', { class: 'inline-prompt-box version-picker' }, [
      el('div', { class: 'inline-prompt-title', text: 'Install ' + (r.name || r.title) }),
      el('div', { class: 'version-picker-sub', text: sorted.length + ' version' + (sorted.length === 1 ? '' : 's') + ' for ' + inst.loader + ' ' + (inst.mcVersion || '') + ' \u2014 latest is preselected' }),
      listWrap,
      el('div', { class: 'inline-prompt-actions' }, [
        cancelBtn,
        installBtn
      ])
    ]))
    items.forEach(i => listWrap.appendChild(i))
    root.appendChild(overlay)
  }

  function searchPanel (label, searchFn, versionLoader) {
    const input = el('input', { class: 'input', placeholder: 'Search ' + label + ' mods...' })
    const btn = el('button', { class: 'btn primary', text: 'Search' })
    const box = el('div', { class: 'mod-results' })
    const panel = el('div', {}, [
      el('div', { class: 'search-row' }, [input, btn]),
      el('div', { class: 'mod-browse-hint', text: 'Browse below \u2014 scroll for more, or search above.' }),
      box
    ])
    let query = ''
    let page = 0
    let loading = false
    let exhausted = false

    async function go (toPage) {
      loading = true
      if (toPage === 0) {
        page = 0
        exhausted = false
        query = input.value.trim()
        box.innerHTML = ''
        box.appendChild(el('div', { class: 'hint', text: 'Searching...' }))
      }
      try {
        const results = await searchFn(query, toPage)
        if (toPage === 0) {
          box.innerHTML = ''
          if (!results.length) {
            exhausted = true
            box.appendChild(el('div', { class: 'hint', text: 'No results. Try a different search.' }))
            return
          }
        }
        renderResults(results, versionLoader, box, toPage !== 0)
        page = toPage
        if (!results.length) {
          exhausted = true
          if (toPage !== 0) box.appendChild(el('div', { class: 'hint', text: 'No more results.' }))
        }
      } catch (e) {
        if (toPage === 0) {
          box.innerHTML = ''
          box.appendChild(el('div', { class: 'hint', text: e.message }))
        } else {
          exhausted = true
          box.appendChild(el('div', { class: 'hint', text: 'Could not load more: ' + e.message }))
        }
      } finally {
        loading = false
      }
    }

    box.addEventListener('scroll', () => {
      if (loading || exhausted) return
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 80) go(page + 1)
    })

    btn.addEventListener('click', () => go(0))
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(0) })
    go(0)
    return panel
  }

  let modrinthPanel, cursePanel, customPanel
  modrinthPanel = searchPanel('Modrinth',
    (q, page) => api.mods.searchModrinth(q, page).then(hits => (hits || []).map(h => ({
      id: h.id,
      slug: h.slug,
      name: h.name || h.title,
      icon: h.icon,
      author: h.author,
      downloads: h.downloads,
      mc: (h.versions || []).slice(-1)[0] || h.mc || '',
      description: h.description || h.summary || ''
    }))),
    (r) => api.mods.modrinthVersions(inst.id, r.id).then(vs => (vs || []).map(v => {
      const f = (v.files || []).find(x => x.primary) || (v.files || [])[0] || {}
      return Object.assign({}, v, {
        fileName: f.filename || '',
        fileLength: f.size || v.downloads,
        install: (jobId) => api.mods.installModrinth(inst.id, r.id, v.id, { name: r.name, slug: r.slug, icon: r.icon }, jobId)
      })
    }))
  )
  cursePanel = searchPanel('CurseForge',
    (q, page) => api.mods.searchCurse(q, page).then(hits => (hits || []).map(h => ({
      id: h.id,
      slug: h.slug,
      name: h.name || h.title,
      icon: h.icon,
      author: h.author,
      downloads: h.downloads,
      mc: h.mc || '',
      description: h.summary || h.description || ''
    }))),
    (r) => api.mods.curseFiles(inst.id, r.id).then(vs => (vs || []).map(v => Object.assign({}, v, { install: (jobId) => api.mods.installCurse(inst.id, r.id, v.id, { name: r.name, slug: r.slug, icon: r.icon }, jobId) })))
  )
  customPanel = el('div', {}, [
    el('div', { class: 'hint', text: 'Install a mod from a .jar file on your computer.' }),
    el('button', { class: 'btn', text: 'Choose JAR...', onclick: async () => {
      try {
        const p = await api.mods.chooseJar()
        if (!p) return
        installFlow(() => api.mods.installCustom(inst.id, p))
      } catch (e) { toast(e.message, 'error') }
    } })
  ])

  const mTabs = {
    modrinth: modrinthPanel,
    curse: cursePanel,
    custom: customPanel
  }
  let mTab = 'modrinth'
  const mtabs = {}
  function makeTab (key, label) {
    const t = el('button', { class: 'tab' + (mTab === key ? ' active' : ''), text: label, onclick: () => switchTab(key) })
    mtabs[key] = t
    return t
  }
  const tabWrap = el('div', { class: 'tabs' }, [makeTab('modrinth', 'Modrinth'), makeTab('curse', 'CurseForge'), makeTab('custom', 'Custom JAR')])
  function switchTab (key) {
    mTab = key
    for (const k of Object.keys(mtabs)) mtabs[k].classList.toggle('active', k === key)
    sourcesWrap.innerHTML = ''
    sourcesWrap.appendChild(mTabs[key])
  }
  sourcesWrap.appendChild(mTabs.modrinth)

  openModal(modalShell('Mods \u2014 ' + inst.name, el('div', {}, [
    el('div', { class: 'mods-section-title', text: 'Installed' }),
    installedWrap,
    el('div', { class: 'mods-section-title', text: 'Install from' }),
    tabWrap,
    el('div', { style: 'height:10px' }),
    sourcesWrap,
    hint,
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn small', text: 'Open mods folder', onclick: () => api.mods.openFolder(inst.id).catch(e => toast(e.message, 'error')) }),
      el('button', { class: 'btn', text: 'Close', onclick: closeModal })
    ])
  ])))
  renderInstalled()
}

function fmtDownloads (n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

/* ---------- launch ---------- */

let consoleInstanceId = null
let consoleRefs = null

async function launchInstance (inst) {
  const account = await api.accounts.selected()
  if (!account) {
    showNoAccountDialog()
    return
  }
  if (state.config.warnInsufficientMemory !== false && inst.customMemory && inst.maxMemory && state.config.maxMemory && inst.maxMemory < state.config.maxMemory) {
    if (!confirm('"' + inst.name + '" is set to ' + inst.maxMemory + ' MB of RAM, below the global default of ' + state.config.maxMemory + ' MB.\n\nLaunch anyway?')) return
  }
  consoleInstanceId = inst.id
  const log = el('div', { class: 'console' })
  const progTitle = el('div', { class: 'progress-title', text: 'Starting ' + inst.name })
  const progSub = el('div', { class: 'progress-sub', text: 'Preparing...' })
  const fill = el('div', { class: 'progress-fill' })
  const stopBtn = el('button', { class: 'btn danger', text: 'Stop' })
  const statusEl = el('div', { class: 'progress-sub', text: '' })

  openModal(modalShell('Playing: ' + inst.name, el('div', {}, [
    el('div', { class: 'progress-track', style: 'height:8px' }, [fill]),
    el('div', {}, [progSub]),
    el('div', { style: 'margin-top:10px' }, [log]),
    statusEl,
    el('div', { class: 'modal-actions' }, [stopBtn])
  ])))
  consoleRefs = { log, fill, progSub, statusEl, stopBtn }

  function logLine (tag, line) {
    const lineEl = el('div', { class: 't-' + tag, text: '[' + tag + '] ' + line })
    log.appendChild(lineEl)
    log.scrollTop = log.scrollHeight
  }

  stopBtn.addEventListener('click', async () => {
    await api.launch.stop(inst.id)
    statusEl.textContent = 'Stopping...'
  })

  logLine('sys', 'Starting process...')
  api.launch.start(inst.id).catch(e => {
    statusEl.textContent = 'Launch error: ' + e.message
    logLine('ERR', e.message)
  })
}

api.launch.onLog(p => {
  if (!consoleRefs || p.instanceId !== consoleInstanceId) return
  const lineEl = el('div', { class: 't-' + (p.tag || 'MC'), text: '[' + (p.tag || 'MC') + '] ' + p.line })
  consoleRefs.log.appendChild(lineEl)
  consoleRefs.log.scrollTop = consoleRefs.log.scrollHeight
})
api.launch.onProgress(p => {
  if (!consoleRefs || p.instanceId !== consoleInstanceId) return
  const pr = p.progress || {}
  if (pr.phase === 'libraries') { consoleRefs.progSub.textContent = 'Libraries ' + pr.done + '/' + pr.total; consoleRefs.fill.style.width = Math.round((pr.done / (pr.total || 1)) * 100) + '%' }
  else if (pr.phase === 'assets') { consoleRefs.progSub.textContent = 'Assets ' + pr.done + '/' + pr.total; consoleRefs.fill.style.width = Math.round((pr.done / (pr.total || 1)) * 100) + '%' }
  else if (pr.phase === 'start') { consoleRefs.progSub.textContent = pr.message }
  else if (pr.phase === 'warn') { consoleRefs.statusEl.textContent = pr.message }
})
api.launch.onExit(p => {
  if (!consoleRefs || p.instanceId !== consoleInstanceId) return
  const info = p.info || {}
  if (info.code === 0) consoleRefs.statusEl.textContent = 'Game exited cleanly.'
  else consoleRefs.statusEl.textContent = 'Game exited with code ' + (info.code === undefined || info.code === null ? '?' : info.code)
  consoleRefs.stopBtn.disabled = true
})

/* ---------- browse ---------- */

function renderBrowse () {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === state.browse.tab)
  })
  document.getElementById('pack-search').value = state.browse.query
  if (!state.browse.results.length && state.browse.query === '') {
    searchPacks()
  } else {
    renderPacks()
  }
}

function renderPacks () {
  const grid = document.getElementById('pack-grid')
  grid.innerHTML = ''
  if (!state.browse.results.length) {
    grid.appendChild(el('div', { class: 'empty-state' }, [
      el('p', { text: 'No modpacks found.' })
    ]))
    return
  }
  for (const pack of state.browse.results) {
    const isCurse = state.browse.tab === 'curse'
    grid.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card-top' }, [
        el('img', { class: 'card-icon', src: pack.icon || iconFor('vanilla'), alt: '' }),
        el('div', {}, [
          el('div', { class: 'card-title', text: pack.title || pack.name }),
          el('div', { class: 'card-sub', text: pack.author })
        ])
      ]),
      el('div', { class: 'card-desc', text: pack.description || pack.summary || '' }),
      el('div', { class: 'badges' }, [
        el('span', { class: 'badge green', text: 'dl: ' + fmtBytes(pack.downloads || 0) }),
        pack.updated && el('span', { class: 'badge', text: 'upd: ' + new Date(pack.updated).toLocaleDateString() })
      ]),
      el('div', { class: 'card-actions' }, [
        el('button', { class: 'btn primary small', text: 'Install', onclick: () => openPackDetail(pack) })
      ])
    ]))
  }
}

async function searchPacks (page) {
  if (page !== undefined) state.browse.page = page
  const grid = document.getElementById('pack-grid')
  grid.innerHTML = el('div', { class: 'empty-state', text: 'Searching...' }).outerHTML
  try {
    let results
    if (state.browse.tab === 'modrinth') {
      results = await api.modrinth.search(state.browse.query, state.browse.page)
    } else {
      results = await api.curse.search(state.browse.query, state.browse.page)
    }
    state.browse.results = results
    renderPacks()
  } catch (e) {
    toast(e.message, 'error')
    state.browse.results = []
    renderPacks()
  }
}

document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    state.browse.tab = t.dataset.tab
    state.browse.page = 0
    state.browse.results = []
    renderBrowse()
  })
})
document.getElementById('btn-search').addEventListener('click', () => {
  state.browse.query = document.getElementById('pack-search').value.trim()
  state.browse.page = 0
  searchPacks(0)
})

function installOptsForm (recommendedRam, packIcon) {
  const dl = el('input', { type: 'checkbox', checked: true })
  const opt = el('input', { type: 'checkbox' })
  const mem = el('input', { type: 'number', value: recommendedRam || state.config.maxMemory || 4096, min: 512, step: 256 })
  const memHint = el('div', { class: 'hint', text: recommendedRam ? 'This pack recommends ' + Math.round(recommendedRam) + ' MB of RAM.' : 'Used for this instance. Change it later under Edit.' })
  return {
    body: el('div', { class: 'form-grid' }, [
      el('div', { class: 'form-field full' }, [el('label', { text: 'Installation options' })]),
      el('div', { class: 'setting-row inline' }, [dl, el('label', { text: 'Download all mods now' })]),
      el('div', { class: 'setting-row inline' }, [opt, el('label', { text: 'Include optional mods' })]),
      el('div', { class: 'form-field full' }, [
        el('label', { text: 'Memory for this pack (MB)' }),
        mem,
        memHint
      ])
    ]),
    get: () => ({
      downloadMods: dl.checked,
      includeOptional: opt.checked,
      maxMemory: parseInt(mem.value, 10) || 0,
      minMemory: 512,
      customMemory: true,
      icon: packIcon || ''
    })
  }
}

async function installViaProgress (fn, name) {
  const jobId = 'inst-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)
  showProgress('Installing ' + name, '', { jobId })
  try {
    const res = await fn(jobId)
    activeJobId = null
    hideProgress()
    toast(name + ' installed!', 'success')
    renderInstances()
  } catch (e) {
    activeJobId = null
    hideProgress()
    if (isCancelled(e)) {
      toast('Install cancelled.', 'error')
      return
    }
    toast('Install failed: ' + e.message, 'error')
  }
}

function latestMcVersion (versions) {
  const list = (versions || []).slice()
  list.sort((x, y) => cmpMcVersion(x, y))
  return list[0] || ''
}

function cmpMcVersion (x, y) {
  const rx = String(x).match(/^1\.(\d+)(?:\.(\d+))?$/)
  const ry = String(y).match(/^1\.(\d+)(?:\.(\d+))?$/)
  if (rx && ry) {
    return (parseInt(ry[1], 10) - parseInt(rx[1], 10)) || (parseInt(ry[2] || 0, 10) - parseInt(rx[2] || 0, 10))
  }
  if (rx) return -1
  if (ry) return 1
  return String(y) < String(x) ? -1 : 1
}

function versionKey (s) {
  const m = String(s).trim().match(/^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.\-]+))?(?:\+.*)?$/)
  if (!m) return { num: [0], pre: [String(s)], isPre: true }
  return { num: m[1].split('.').map(n => parseInt(n, 10) || 0), pre: m[2] ? m[2].split(/[.-]/).filter(Boolean) : null, isPre: !!m[2] }
}

function cmpVersions (a, b) {
  const ka = versionKey(a)
  const kb = versionKey(b)
  const maxLen = Math.max(ka.num.length, kb.num.length)
  for (let i = 0; i < maxLen; i++) {
    const na = ka.num[i] || 0
    const nb = kb.num[i] || 0
    if (na !== nb) return nb - na
  }
  if (ka.isPre !== kb.isPre) return ka.isPre ? 1 : -1
  if (ka.isPre && kb.isPre) {
    const len = Math.max(ka.pre.length, kb.pre.length)
    for (let i = 0; i < len; i++) {
      const pa = ka.pre[i] || ''
      const pb = kb.pre[i] || ''
      const na = parseInt(pa, 10)
      const nb = parseInt(pb, 10)
      if (!isNaN(na) && !isNaN(nb)) {
        if (na !== nb) return nb - na
      } else if (pa !== pb) {
        return pa < pb ? 1 : -1
      }
    }
  }
  return 0
}

function sortPackVersions (a, b) {
  const ma = latestMcVersion(a.game_versions || a.gameVersions)
  const mb = latestMcVersion(b.game_versions || b.gameVersions)
  if (ma && mb && ma !== mb) return cmpMcVersion(ma, mb)
  if (ma && !mb) return -1
  if (!ma && mb) return 1
  return cmpVersions(a.version_number || a.fileName || a.displayName || '', b.version_number || b.fileName || b.displayName || '')
}

async function openPackDetail (pack) {
  if (state.browse.tab === 'modrinth') {
    const opts = installOptsForm(0, pack.icon)
    const versWrap = el('div', { class: 'pack-versions' })
    openModal(modalShell(pack.title, el('div', {}, [
      el('div', { class: 'pack-detail' }, [
        el('img', { class: 'pack-icon', src: pack.icon || iconFor('vanilla'), alt: '' }),
        el('div', { class: 'pack-meta' }, [
          el('div', { text: pack.description || '' }),
          el('div', { class: 'pack-stats' }, [
            'by ' + pack.author + ' \u2022 ' + fmtBytes(pack.downloads) + ' downloads',
            pack.server && el('div', { text: 'server side: ' + pack.server })
          ])
        ])
      ]),
      el('h3', { style: 'margin-top:16px', text: 'Versions' }),
      versWrap,
      opts.body,
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn', text: 'Cancel', onclick: closeModal })
      ])
    ])))
    try {
      const versions = await api.modrinth.versions(pack.id)
      const sorted = versions.slice().sort(sortPackVersions)
      for (const v of sorted.slice(0, 20)) {
        versWrap.appendChild(el('div', { class: 'pack-version' }, [
          el('span', { class: 'ver-name', text: v.name }),
          el('span', { class: 'ver-meta', text: (v.game_versions || []).join(', ') + ' \u2022 ' + (v.loaders || []).join(', ') }),
          el('button', { class: 'btn small', text: 'Install',
            onclick: () => {
              closeModal()
              installViaProgress((jobId) => api.modrinth.import(pack.id, v.id, opts.get(), jobId), pack.title)
            }
          })
        ]))
      }
    } catch (e) {
      versWrap.appendChild(el('div', { class: 'card-sub', text: 'Failed to load versions: ' + e.message }))
    }
  } else {
    const opts = installOptsForm(0, pack.icon)
    const filesWrap = el('div', { class: 'pack-versions' })
    openModal(modalShell(pack.name, el('div', {}, [
      el('div', { class: 'pack-detail' }, [
        el('img', { class: 'pack-icon', src: pack.icon || iconFor('vanilla'), alt: '' }),
        el('div', { class: 'pack-meta' }, [
          el('div', { text: pack.summary || '' }),
          el('div', { class: 'pack-stats', text: 'by ' + pack.author + ' \u2022 ' + fmtBytes(pack.downloads) + ' downloads' })
        ])
      ]),
      el('h3', { style: 'margin-top:16px', text: 'Files' }),
      filesWrap,
      opts.body,
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn', text: 'Cancel', onclick: closeModal })
      ])
    ])))
    try {
      const files = await api.curse.files(pack.id, {})
      for (const f of files.slice().sort(sortPackVersions).slice(0, 30)) {
        filesWrap.appendChild(el('div', { class: 'pack-version' }, [
          el('div', {}, [
            el('div', { class: 'ver-name', text: f.displayName }),
            el('div', { class: 'ver-meta', text: (f.gameVersions || []).slice(-2).join(', ') })
          ]),
          el('button', { class: 'btn small', text: 'Install',
            onclick: () => {
              closeModal()
              installViaProgress((jobId) => api.curse.import(pack.id, f.id, opts.get(), jobId), pack.name)
            }
          })
        ]))
      }
    } catch (e) {
      filesWrap.appendChild(el('div', { class: 'card-sub', text: 'Failed to load files: ' + e.message }))
    }
  }
}

/* ---------- import file ---------- */

async function importFromFile () {
  const file = await api.packs.choose()
  if (!file) return
  const type = await api.packs.detect(file)
  let recRam = 0
  try { recRam = await api.packs.recommendedRam(file) } catch {}
  const opts = installOptsForm(recRam)
  const typeLabel = { mrpack: 'Modrinth pack (.mrpack)', curse: 'CurseForge pack', prism: 'Prism / MultiMC pack' }[type] || type
  openModal(modalShell('Import Modpack', el('div', {}, [
    el('div', { class: 'card-sub', text: file }),
    el('div', { class: 'badge', text: typeLabel }),
    opts.body,
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn', text: 'Cancel', onclick: closeModal }),
      el('button', { class: 'btn primary', text: 'Import', onclick: () => {
        closeModal()
        const nm = file.split(/[\\/]/).pop().replace(/\.(mrpack|zip)$/i, '')
        installViaProgress((jobId) => api.packs.import(file, opts.get(), jobId), nm)
      } })
    ])
  ])))
}

/* ---------- settings ---------- */

function openDownloadJava () {
  const providerSel = el('select', {})
  const versionSel = el('select', {})
  const hint = el('div', { class: 'hint', text: 'Choose a provider, then pick a Java version to download.' })
  for (const p of [['adoptium', 'Adoptium OpenJDK'], ['oracle', 'Oracle Java'], ['mojang', 'Mojang Java']]) {
    providerSel.appendChild(el('option', { value: p[0], text: p[1] }))
  }

  async function fillVersions () {
    versionSel.innerHTML = ''
    versionSel.appendChild(el('option', { value: '', text: 'Loading versions...' }))
    try {
      const versions = await api.java.listProviderVersions(providerSel.value)
      versionSel.innerHTML = ''
      if (!versions.length) {
        versionSel.appendChild(el('option', { value: '', text: 'No versions available' }))
      } else {
        for (const v of versions) versionSel.appendChild(el('option', { value: v.value, text: v.label }))
      }
    } catch (e) {
      versionSel.innerHTML = ''
      versionSel.appendChild(el('option', { value: '', text: e.message }))
    }
  }
  providerSel.addEventListener('change', fillVersions)
  fillVersions()

  const downloadBtn = el('button', { class: 'btn primary', text: 'Download & Set', onclick: async () => {
    const provider = providerSel.value
    const value = versionSel.value
    if (!value) { toast('Pick a Java version first', 'error'); return }
    showProgress('Downloading Java')
    try {
      const p = await api.java.downloadProvider(provider, value)
      hideProgress()
      closeModal()
      await api.config.set({ javaPath: p })
      state.config = await api.config.get()
      toast('Java downloaded and set', 'success')
      renderSettings()
    } catch (e) { hideProgress(); toast(e.message, 'error') }
  } })

  openModal(modalShell('Download Java', el('div', {}, [
    el('div', { class: 'setting-row' }, [el('label', { text: 'Provider' }), providerSel]),
    el('div', { class: 'setting-row' }, [el('label', { text: 'Version' }), versionSel]),
    hint,
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn', text: 'Cancel', onclick: closeModal }),
      downloadBtn
    ])
  ])))
}

async function renderSettings () {
  const form = document.getElementById('settings-form')
  form.innerHTML = ''

  const maxMem = el('input', { type: 'number', value: state.config.maxMemory, min: 512, step: 256 })
  const minMem = el('input', { type: 'number', value: state.config.minMemory, min: 256, step: 128 })
  const width = el('input', { type: 'number', value: state.config.resolution.width })
  const height = el('input', { type: 'number', value: state.config.resolution.height })
  const dlLoc = el('input', { value: state.config.downloadsLocation })

  const themeSel = el('select', {})
  for (const [k, label] of [['midnight', 'Midnight'], ['dark', 'Dark'], ['light', 'Light']]) {
    themeSel.appendChild(el('option', { value: k, text: label }))
  }
  themeSel.value = state.config.theme || 'midnight'
  themeSel.addEventListener('change', () => applyTheme(themeSel.value))

  const javaSel = el('select', {})
  const pathHint = el('div', { class: 'hint path-hint', title: state.config.javaPath || '', text: state.config.javaPath || 'Auto-detect: the best Java for each Minecraft version is picked automatically.' })
  const disableAuto = el('input', { type: 'checkbox', checked: !!state.config.disableAutoJava })
  const autoDlJava = el('input', { type: 'checkbox', checked: state.config.autoDownloadJava !== false })
  const warnMem = el('input', { type: 'checkbox', checked: state.config.warnInsufficientMemory !== false })
  const trackTime = el('input', { type: 'checkbox', checked: state.config.trackPlaytime !== false })
  function updatePathHint () {
    if (javaSel.value) {
      pathHint.textContent = javaSel.value
      pathHint.title = javaSel.value
    } else {
      pathHint.textContent = 'Auto-detect: the best Java for each Minecraft version is picked automatically.'
      pathHint.title = ''
    }
  }
  javaSel.addEventListener('change', updatePathHint)
  const detectBtn = el('button', { class: 'btn small', text: 'Detect', onclick: async () => {
    const found = await api.java.detect()
    javaSel.innerHTML = ''
    if (!found.length) javaSel.appendChild(el('option', { value: '', text: 'No Java found' }))
    for (const j of found) {
      javaSel.appendChild(el('option', { value: j.path, text: shortJavaLabel(j) }))
    }
    const cfg = state.config.javaPath
    if (cfg && !found.some(j => j.path === cfg)) {
      javaSel.appendChild(el('option', { value: cfg, text: 'Java (configured) \u00b7 ' + String(cfg).replace(/\\/g, '/').split('/').filter(Boolean).pop() }))
    }
    if (cfg) javaSel.value = cfg
    updatePathHint()
  } })
  const dlBtn = el('button', { class: 'btn small', text: 'Download Java', onclick: () => openDownloadJava() })

  form.appendChild(el('div', { class: 'setting-card' }, [
    el('h3', { text: 'Account' }),
    el('div', { id: 'account-card', class: 'account-list', text: 'Loading...' })
  ]))
  buildAccountCard().catch(e => toast(e.message, 'error'))
  form.appendChild(el('div', { class: 'setting-card' }, [
    el('h3', { text: 'Java' }),
    el('div', { class: 'setting-row' }, [
      el('label', { text: 'Java executable' }),
      el('div', { class: 'search-row' }, [javaSel, detectBtn, dlBtn]),
      pathHint
    ]),
    el('div', { class: 'setting-row inline' }, [disableAuto, el('label', { text: 'Disable auto Java selection' })]),
    el('div', { class: 'setting-row inline' }, [autoDlJava, el('label', { text: 'Auto-download Java when missing at launch' })])
  ]))
  form.appendChild(el('div', { class: 'setting-card' }, [
    el('h3', { text: 'Memory & Resolution' }),
    el('div', { class: 'setting-row' }, [el('label', { text: 'Max memory (MB)' }), maxMem]),
    el('div', { class: 'setting-row' }, [el('label', { text: 'Min memory (MB)' }), minMem]),
    el('div', { class: 'setting-row' }, [el('label', { text: 'Resolution width (px)' }), width]),
    el('div', { class: 'setting-row' }, [el('label', { text: 'Resolution height (px)' }), height])
  ]))
  form.appendChild(el('div', { class: 'setting-card' }, [
    el('h3', { text: 'Launcher Behavior' }),
    el('div', { class: 'setting-row inline' }, [warnMem, el('label', { text: 'Warn when an instance uses less RAM than the global default' })]),
    el('div', { class: 'setting-row inline' }, [trackTime, el('label', { text: 'Track playtime per instance' })])
  ]))
  form.appendChild(el('div', { class: 'setting-card' }, [
    el('h3', { text: 'Modpacks & Downloads' }),
    el('div', { class: 'setting-row' }, [el('label', { text: 'Downloads location' }), dlLoc]),
    el('div', { class: 'hint', text: 'CurseForge and Modrinth browsing work without any API key.' })
  ]))
  form.appendChild(el('div', { class: 'setting-card' }, [
    el('h3', { text: 'Appearance' }),
    el('div', { class: 'setting-row' }, [el('label', { text: 'Theme' }), themeSel])
  ]))

  const saveBtn = el('button', { class: 'btn primary', text: 'Save Settings', onclick: async () => {
    const patch = {
      maxMemory: parseInt(maxMem.value, 10) || 4096,
      minMemory: parseInt(minMem.value, 10) || 512,
      resolution: { width: parseInt(width.value, 10) || 854, height: parseInt(height.value, 10) || 480 },
      downloadsLocation: dlLoc.value.trim(),
      javaPath: javaSel.value || '',
      disableAutoJava: disableAuto.checked,
      autoDownloadJava: autoDlJava.checked,
      warnInsufficientMemory: warnMem.checked,
      trackPlaytime: trackTime.checked,
      theme: themeSel.value
    }
    await api.config.set(patch)
    state.config = await api.config.get()
    toast('Settings saved', 'success')
    renderUserChip()
  } })
  form.appendChild(el('div', { style: 'grid-column:1/-1' }, [saveBtn]))
}

/* ---------- 3D skin preview ---------- */

function makeViewer3D (url, slim, capeUrl, opts) {
  opts = opts || {}
  const vWrap = el('div', { class: 'skin-3d-wrap' })
  const hint = el('div', { class: 'hint', text: 'Loading preview...' })
  const canvas = el('canvas', { class: 'skin-3d-canvas' })
  const viewer = new skinview3d.SkinViewer({
    canvas,
    width: 220,
    height: 300,
    model: slim ? 'slim' : 'default'
  })
  viewer.autoRotate = true
  viewer.playerObject.rotation.y = 0
  const camDist = viewer.camera.position.length()
  viewer.camera.position.set(0, 0.2, 1).normalize().multiplyScalar(camDist)
  viewer.camera.lookAt(0, 0, 0)

  let dragging = false
  let lastX = 0
  let lastY = 0
  const onDown = e => {
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
    viewer.autoRotate = false
    try { canvas.setPointerCapture(e.pointerId) } catch {}
  }
  const onMove = e => {
    if (!dragging) return
    viewer.playerObject.rotation.y += (e.clientX - lastX) * 0.01
    const pos = viewer.camera.position
    const dist = pos.length()
    let pitch = Math.asin(Math.max(-1, Math.min(1, pos.y / dist)))
    pitch = Math.max(-1, Math.min(1, pitch + (e.clientY - lastY) * 0.006))
    viewer.camera.position.set(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist)
    viewer.camera.lookAt(0, 0, 0)
    lastX = e.clientX
    lastY = e.clientY
  }
  const onUp = () => { dragging = false }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)

  viewer.loadSkin(url).then(() => {
    if (!hint.isConnected) return
    hint.remove()
  }).catch(() => { if (hint.isConnected) hint.textContent = 'Preview unavailable' })
  if (capeUrl) viewer.loadCape(capeUrl).catch(() => {})
  else viewer.playerObject.cape.visible = false

  const dispose = () => {
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('pointercancel', onUp)
    try { viewer.dispose() } catch {}
  }
  vWrap.appendChild(canvas)
  vWrap.appendChild(hint)
  canvas.__viewer = viewer
  return { wrap: vWrap, dispose }
}

async function openSkinModal (acc) {
  const wrap = el('div', {})
  let current = null
  let uploading = false
  let pending = null
  let previewCape = null
  let viewers = []

  async function load () {
    wrap.innerHTML = ''
    wrap.appendChild(el('p', { class: 'hint', text: 'Loading profile...' }))
    try {
      current = await api.skins.profile(acc.id)
      render()
    } catch (e) {
      wrap.innerHTML = ''
      wrap.appendChild(el('p', { text: 'Could not load your skin profile: ' + e.message }))
      wrap.appendChild(el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn', text: 'Close', onclick: closeModal }),
        el('button', { class: 'btn primary', text: 'Retry', onclick: load })
      ]))
    }
  }

  function render () {
    wrap.innerHTML = ''
    viewers.forEach(v => v.dispose())
    viewers = []
    const skin = current.skins && current.skins[0]

    const makeViewer = (url, slim, capeUrl) => {
      const v = makeViewer3D(url, slim, capeUrl)
      viewers.push(v)
      return v.wrap
    }

    const variantSel = el('select', {})
    for (const [v, l] of [['CLASSIC', 'Classic'], ['SLIM', 'Slim']]) {
      variantSel.appendChild(el('option', { value: v, text: l, selected: !!(skin && skin.variant === v) }))
    }
    variantSel.addEventListener('change', render)

    const capes = current.capes || []
    const activeCape = capes.find(c => c.state === 'ACTIVE')
    const previewObj = previewCape && previewCape !== 'none' ? capes.find(c => c.id === previewCape) : null
    const capeUrl = previewCape === 'none' ? null : previewObj ? previewObj.url : activeCape ? activeCape.url : null

    const currentBox = el('div', { class: 'skin-box' }, [
      skin && skin.url ? makeViewer(skin.url, skin.variant === 'SLIM', capeUrl) : el('div', { class: 'skin-empty', text: 'No skin' })
    ])
    const newBox = el('div', { class: 'skin-box' }, [
      pending ? makeViewer(pending.url, variantSel.value === 'SLIM', capeUrl) : el('div', { class: 'skin-empty', text: 'No new skin chosen' })
    ])

    const chooseBtn = el('button', { class: 'btn small', text: 'Choose New Skin', disabled: uploading, onclick: async () => {
      if (uploading) return
      const pick = await api.skins.choose()
      if (!pick) return
      pending = { file: pick.path, url: pick.preview }
      render()
    } })
    const applySkinBtn = el('button', { class: 'btn primary small', text: 'Apply New Skin', disabled: !pending || uploading, onclick: async () => {
      if (!pending || uploading) return
      uploading = true
      showProgress('Uploading skin')
      try {
        current = await api.skins.upload(acc.id, pending.file, variantSel.value)
        pending = null
        uploading = false
        toast('Skin updated', 'success')
        render()
      } catch (e) { toast(e.message, 'error') } finally { uploading = false; hideProgress() }
    } })
    const cancelSkinBtn = el('button', { class: 'btn small', text: 'Cancel', disabled: !pending, onclick: () => { pending = null; render() } })
    const removeBtn = el('button', { class: 'btn danger small', text: 'Remove Skin', disabled: !skin, onclick: async () => {
      if (uploading || !skin) return
      uploading = true
      showProgress('Removing skin')
      try {
        current = await api.skins.remove(acc.id, skin.id)
        uploading = false
        toast('Skin removed', 'success')
        render()
      } catch (e) { toast(e.message, 'error') } finally { uploading = false; hideProgress() }
    } })

    const noneCape = el('div', {
      class: 'cape-cell' + (!activeCape ? ' active' : '') + (previewCape === 'none' ? ' preview' : ''),
      onclick: () => {
        if (!activeCape && previewCape !== 'none') return
        if (uploading) return
        previewCape = previewCape === 'none' ? null : 'none'
        render()
      }
    }, [
      el('div', { class: 'skin-empty none-cape', text: '\u2715' }),
      el('div', { class: 'cape-cell-info' }, [
        el('div', { class: 'cape-name', text: 'No cape' }),
        el('div', { class: 'cape-state' + (!activeCape ? ' selected' : '') + (previewCape === 'none' ? ' previewing' : ''), text: !activeCape ? 'Selected' : previewCape === 'none' ? 'Previewing' : 'Click to preview' })
      ])
    ])

    const capeCells = [noneCape].concat(capes.map(c => {
      const isActive = c.state === 'ACTIVE'
      const isPreview = c.id === previewCape
      return el('div', { class: 'cape-cell' + (isActive ? ' active' : '') + (isPreview ? ' preview' : ''), onclick: () => {
        if (isActive || uploading) return
        previewCape = isPreview ? null : c.id
        render()
      } }, [
        c.url ? el('img', { class: 'cape-preview', src: c.url, alt: 'Cape' }) : el('div', { class: 'skin-empty', text: '?' }),
        el('div', { class: 'cape-cell-info' }, [
          el('div', { class: 'cape-name', text: c.alias || c.id || 'Cape' }),
          el('div', { class: 'cape-state' + (isActive ? ' selected' : '') + (isPreview ? ' previewing' : ''), text: isActive ? 'Selected' : isPreview ? 'Previewing' : 'Click to preview' })
        ])
      ])
    }))

    const capeBox = el('div', { class: 'skin-box' }, [
      el('div', { class: 'cape-row' }, capeCells),
      el('div', { class: 'hint', text: capes.length
        ? 'Click a cape to preview it, then press "Apply Cape". The cape you currently have is marked "Selected".'
        : 'No capes owned. Capes are assigned by Mojang and cannot be uploaded.' }),
      el('div', { class: 'cape-actions' }, [
        el('span', { class: 'hint', text: previewCape === 'none'
          ? 'Previewing: No cape (capes cannot be removed from a Mojang account)'
          : previewObj ? 'Previewing: ' + (previewObj.alias || previewObj.id)
          : 'Currently selected: ' + (activeCape ? (activeCape.alias || activeCape.id) : 'none') }),
        el('button', { class: 'btn primary small', text: 'Apply Cape', disabled: !previewObj || uploading, onclick: async () => {
          if (!previewObj || uploading) return
          uploading = true
          showProgress('Changing cape')
          try {
            current = await api.skins.setCape(acc.id, previewObj.id)
            previewCape = null
            uploading = false
            toast('Cape changed', 'success')
            render()
          } catch (e) { toast(e.message, 'error') } finally { uploading = false; hideProgress() }
        } })
      ])
    ])

    const presets = state.config.skinPresets || []
    const savePresetBtn = el('button', { class: 'btn small', text: 'Save Preset', disabled: !skin || uploading, onclick: async () => {
      if (!skin || uploading) return
      if (!/^data:image\//.test(skin.url || '')) { toast('Cannot save preset: skin image unavailable', 'error'); return }
      const name = await inlinePrompt('Save skin & cape preset', 'Preset name')
      if (!name) return
      const pick = previewCape === 'none' ? null : previewCape ? capes.find(c => c.id === previewCape) : activeCape
      const newPreset = {
        id: 'preset-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name,
        variant: skin.variant || 'CLASSIC',
        skinData: skin.url,
        capeId: pick ? pick.id : null,
        capeUrl: pick ? (pick.url || null) : null
      }
      state.config = await api.config.set({ skinPresets: presets.concat([newPreset]) })
      render()
    } })

    const presetBox = el('div', { class: 'skin-box preset-box' }, presets.length
      ? [el('div', { class: 'preset-row' }, presets.map(p => {
          const pCape = p.capeId ? capes.find(c => c.id === p.capeId) : null
          return el('div', { class: 'preset-cell' }, [
            p.skinData ? el('img', { class: 'preset-thumb', src: p.skinData, alt: p.name }) : el('div', { class: 'skin-empty', text: '?' }),
            el('div', { class: 'preset-cell-info' }, [
              el('div', { class: 'preset-name', text: p.name }),
              el('div', { class: 'preset-meta', text: (p.variant === 'SLIM' ? 'Slim' : 'Classic') + (pCape ? ' \u00b7 ' + (pCape.alias || pCape.id) : p.capeId ? ' \u00b7 unknown cape' : ' \u00b7 no cape') })
            ]),
            el('div', { class: 'preset-actions' }, [
              el('button', { class: 'btn primary small', text: 'Apply', disabled: uploading, onclick: () => applyPreset(p) }),
              el('button', { class: 'btn danger small', text: '\u2715', title: 'Delete preset', disabled: uploading, onclick: () => deletePreset(p) })
            ])
          ])
        }))]
      : [el('div', { class: 'hint', text: 'Save your current skin & cape as a preset to quickly switch between combos later.' })])

    wrap.appendChild(el('div', { class: 'skin-grid' }, [
      el('div', {}, [el('div', { class: 'skin-label' }, [el('span', { text: 'Current skin' }), skin && el('span', { class: 'badge' + (skin.variant === 'SLIM' ? ' loader' : ''), text: skin.variant || 'CLASSIC' })]), currentBox]),
      el('div', {}, [el('div', { class: 'skin-label' }, [el('span', { text: 'New skin' })]), newBox])
    ]))
    wrap.appendChild(el('div', { class: 'skin-label' }, [el('span', { text: 'Cape' })]))
    wrap.appendChild(capeBox)
    wrap.appendChild(el('div', { class: 'skin-label' }, [el('span', { text: 'Presets' })]))
    wrap.appendChild(presetBox)
    wrap.appendChild(el('div', { class: 'skin-actions' }, [
      el('label', { text: 'Model' }),
      variantSel,
      chooseBtn,
      applySkinBtn,
      cancelSkinBtn,
      removeBtn,
      savePresetBtn
    ]))
    wrap.appendChild(el('div', { class: 'hint', text: 'Skins and the active cape update in-game after you rejoin.' }))
  }

  async function applyPreset (preset) {
    if (uploading) return
    uploading = true
    showProgress('Applying preset')
    try {
      const capes = current.capes || []
      const activeCape = capes.find(c => c.state === 'ACTIVE')
      if (preset.capeId && (!activeCape || activeCape.id !== preset.capeId)) {
        current = await api.skins.setCape(acc.id, preset.capeId)
      }
      const curSkin = current.skins && current.skins[0]
      if (preset.skinData && (!curSkin || curSkin.url !== preset.skinData)) {
        current = await api.skins.uploadData(acc.id, preset.skinData, preset.variant)
      }
      previewCape = null
      toast('Preset applied', 'success')
      render()
    } catch (e) { toast(e.message, 'error') } finally { uploading = false; hideProgress() }
  }

  async function deletePreset (preset) {
    const presets = (state.config.skinPresets || []).filter(p => p.id !== preset.id)
    state.config = await api.config.set({ skinPresets: presets })
    render()
  }

  openModal(modalShell('Skin & Cape - ' + acc.username, wrap))
  load()
}

async function buildAccountCard () {
  const wrap = document.getElementById('account-card')
  if (!wrap) return
  const list = await api.accounts.list()
  const sel = await api.accounts.selected()
  wrap.innerHTML = ''
  if (!list.length) {
    wrap.appendChild(el('div', { class: 'hint', text: 'No account set up.' }))
  }
  for (const acc of list) {
    wrap.appendChild(el('div', { class: 'account-row' + (sel && sel.id === acc.id ? ' selected' : '') }, [
      el('div', { class: 'account-row-info' }, [
        el('div', { class: 'account-row-name', text: acc.username }),
        el('div', { class: 'account-row-meta', text: acc.type === 'microsoft' ? 'Microsoft Account' : 'Offline Account' })
      ]),
      el('div', { class: 'account-row-btns' }, [
        el('button', { class: 'btn small', text: sel && sel.id === acc.id ? 'Selected' : 'Select',
          disabled: !!(sel && sel.id === acc.id), onclick: async () => {
            await api.accounts.setSelected(acc.id)
            buildAccountCard()
            renderUserChip()
          } }),
        acc.type === 'microsoft' && el('button', { class: 'btn small', text: 'Skin & Cape', onclick: () => openSkinModal(acc) }),
        el('button', { class: 'btn danger small', text: 'Remove', onclick: async () => {
          await api.accounts.remove(acc.id)
          buildAccountCard()
          renderUserChip()
        } })
      ])
    ]))
  }
  requestAnimationFrame(() => {
    wrap.querySelectorAll('.account-row-name').forEach(n => fitOneLine(n, 11))
  })
  const actions = el('div', { class: 'account-actions' }, [
    el('button', { class: 'btn small', text: 'Add Microsoft', onclick: async () => {
      try {
        await beginMicrosoftLogin()
        toast('Account added', 'success')
        buildAccountCard()
        renderUserChip()
      } catch (e) {
        if (!e.cancelled) toast(e.message, 'error')
      }
    } }),
    el('button', { class: 'btn small', text: 'Add Offline', onclick: async () => {
      const name = await promptForUsername('Add offline account')
      if (name === null) return
      await api.accounts.addOffline(name)
      buildAccountCard()
      renderUserChip()
    } })
  ])
  wrap.appendChild(actions)
}

/* ---------- init ---------- */

function applyTheme (theme) {
  document.documentElement.dataset.theme = theme || 'midnight'
}

document.getElementById('btn-new').addEventListener('click', newInstance)
document.getElementById('btn-import').addEventListener('click', importFromFile)

/* ---------- window controls (frameless) ---------- */

function wireWindowControls () {
  const min = document.getElementById('win-min')
  const max = document.getElementById('win-max')
  const close = document.getElementById('win-close')
  if (!min || !max || !close) return
  const invoke = (ch) => {
    if (api.window && api.window[ch]) api.window[ch]().catch(() => {})
  }
  min.addEventListener('click', () => invoke('minimize'))
  max.addEventListener('click', () => invoke('toggleMaximize'))
  close.addEventListener('click', () => invoke('close'))
  if (api.window && api.window.onMaximized) {
    const MAX_ICON = '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" stroke="currentColor" stroke-width="1" fill="none"/></svg>'
    const RESTORE_ICON = '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="4" width="6" height="6" stroke="currentColor" stroke-width="1" fill="none"/><rect x="4.5" y="1.5" width="6" height="6" stroke="currentColor" stroke-width="1" fill="none"/></svg>'
    api.window.onMaximized(v => {
      max.innerHTML = v ? RESTORE_ICON : MAX_ICON
      document.body.classList.toggle('maximized', v)
    })
  }
}
wireWindowControls()

async function init () {
  state.config = await api.config.get()
  applyTheme(state.config.theme)
  renderUserChip()
  renderInstances()
  if (!state.config.onboarded) runWizard()
}

init()
