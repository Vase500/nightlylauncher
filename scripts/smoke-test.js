'use strict'
const paths = require('../core/paths')
const launcher = require('../core/launcher')
const instances = require('../core/instances')
const accounts = require('../core/accounts')

;(async () => {
  paths.init()
  let testAccountId = null
  if (!accounts.selected()) testAccountId = accounts.addOffline('SmokeTestUser').id
  const inst = instances.create({
    name: 'launch-test',
    loader: 'vanilla',
    mcVersion: '1.8.9',
    versionId: '1.8.9',
    maxMemory: 2048
  })
  const logs = []
  try {
    await launcher.launch(inst, {
      onProgress: p => { if (p.phase === 'warn') console.log('WARN:', p.message) },
      onLog: (tag, line) => logs.push([tag, line]),
      onExit: info => { logs.push(['EXIT', JSON.stringify(info)]) }
    })
    console.log('process spawned. waiting 25s for boot...')
    await new Promise(r => setTimeout(r, 25000))
    const alive = launcher.isRunning(inst.id)
    console.log('still running after 25s:', alive)
    launcher.stop(inst.id)
    await new Promise(r => setTimeout(r, 3000))
    console.log('stopped. isRunning:', launcher.isRunning(inst.id))
  } catch (e) {
    console.log('launch threw:', e.message)
  }
  const mcLogs = logs.filter(l => l[0] === 'MC')
  const errLogs = logs.filter(l => l[0] === 'ERR')
  console.log('--- MC lines (' + mcLogs.length + ') ---')
  console.log(mcLogs.slice(0, 30).map(l => l[1]).join('\n'))
  console.log('--- ERR lines (' + errLogs.length + ') ---')
  console.log(errLogs.slice(0, 10).map(l => l[1]).join('\n'))
  const exitLine = logs.find(l => l[0] === 'EXIT')
  if (exitLine) console.log('exit:', exitLine[1])
  instances.remove(inst.id)
  if (testAccountId) accounts.remove(testAccountId)
})().catch(e => { console.error('FAIL:', e.message); process.exit(1) })
