'use strict'
const fs = require('fs')
const path = require('path')

function inPath (name) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const d of dirs) {
    try {
      fs.accessSync(path.resolve(d, name), fs.constants.X_OK)
      return true
    } catch {}
  }
  return false
}

function detect () {
  return {
    gamemode: inPath('gamemoderun'),
    mangohud: inPath('mangohud')
  }
}

module.exports = { detect, inPath }
