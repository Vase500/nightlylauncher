'use strict'
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const SIZE = 512
const img = Buffer.alloc(SIZE * SIZE * 4)

function setPx (x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const i = (y * SIZE + x) * 4
  img[i] = r; img[i + 1] = g; img[i + 2] = b; img[i + 3] = a
}

function blend (x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const i = (y * SIZE + x) * 4
  const na = a / 255
  const oa = img[i + 3] / 255
  const outA = na + oa * (1 - na)
  if (outA <= 0) return
  img[i] = Math.round((r * na + img[i] * oa * (1 - na)) / outA)
  img[i + 1] = Math.round((g * na + img[i + 1] * oa * (1 - na)) / outA)
  img[i + 2] = Math.round((b * na + img[i + 2] * oa * (1 - na)) / outA)
  img[i + 3] = Math.round(outA * 255)
}

const PALETTE = {
  top: [18, 12, 48],
  mid: [38, 22, 74],
  bottom: [6, 6, 16],
  moon: [238, 240, 255],
  glow: [120, 130, 255],
  text: [222, 230, 255],
  textDim: [140, 152, 220],
  star: [255, 255, 255]
}

for (let y = 0; y < SIZE; y++) {
  const t = y / SIZE
  let r, g, b
  if (t < 0.55) {
    const k = t / 0.55
    r = PALETTE.top[0] + (PALETTE.mid[0] - PALETTE.top[0]) * k
    g = PALETTE.top[1] + (PALETTE.mid[1] - PALETTE.top[1]) * k
    b = PALETTE.top[2] + (PALETTE.mid[2] - PALETTE.top[2]) * k
  } else {
    const k = (t - 0.55) / 0.45
    r = PALETTE.mid[0] + (PALETTE.bottom[0] - PALETTE.mid[0]) * k
    g = PALETTE.mid[1] + (PALETTE.bottom[1] - PALETTE.mid[1]) * k
    b = PALETTE.mid[2] + (PALETTE.bottom[2] - PALETTE.mid[2]) * k
  }
  for (let x = 0; x < SIZE; x++) setPx(x, y, r, g, b, 255)
}

function disc (cx, cy, rad) {
  for (let y = Math.floor(cy - rad); y <= cy + rad; y++) {
    for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
      const dx = x - cx, dy = y - cy
      if (dx * dx + dy * dy <= rad * rad) return true
    }
  }
  return false
}

function drawMoon (cx, cy, rad, offsetX, offsetY) {
  for (let y = Math.floor(cy - rad - 4); y <= cy + rad + 4; y++) {
    for (let x = Math.floor(cx - rad - 4); x <= cx + rad + 4; x++) {
      const glow = 90 - Math.hypot(x - cx, y - cy) * 0.55
      if (glow > 0) blend(x, y, PALETTE.glow[0], PALETTE.glow[1], PALETTE.glow[2], Math.min(glow, 40))
    }
  }
  for (let y = Math.floor(cy - rad); y <= cy + rad; y++) {
    for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
      const dx = x - cx, dy = y - cy
      if (dx * dx + dy * dy <= rad * rad) {
        const shade = 1 - Math.hypot(dx, dy) / rad * 0.18
        blend(x, y, PALETTE.moon[0] * shade, PALETTE.moon[1] * shade, PALETTE.moon[2] * shade, 255)
      }
    }
  }
  for (let y = Math.floor(cy - rad); y <= cy + rad; y++) {
    for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
      const dx = x - cx + offsetX, dy = y - cy + offsetY
      if (dx * dx + dy * dy <= rad * rad) setPx(x, y, 0, 0, 0, 0)
    }
  }
}

drawMoon(392, 150, 92, 34, -20)

function star4 (cx, cy, size) {
  const r1 = size, r2 = size * 0.4
  for (let y = cy - r1; y <= cy + r1; y++) {
    for (let x = cx - r1; x <= cx + r1; x++) {
      const dx = Math.abs(x - cx), dy = Math.abs(y - cy)
      const on = (dx === 0 && dy <= r1) || (dy === 0 && dx <= r1) ||
        (Math.abs(dx - dy) <= 0.6 && Math.hypot(dx, dy) <= r2)
      if (on) blend(x, y, 255, 255, 255, 235)
    }
  }
  blend(cx, cy, 255, 255, 255, 255)
}

const stars = [[64, 96, 3], [130, 200, 2], [205, 82, 2], [60, 320, 2], [300, 60, 2], [452, 60, 3], [150, 60, 1], [470, 210, 2], [28, 200, 1], [250, 150, 1], [330, 340, 2], [80, 420, 1], [220, 400, 1], [420, 430, 2], [500, 330, 1], [360, 240, 1], [44, 470, 1], [290, 470, 2]]
for (const [x, y, s] of stars) star4(x, y, s)

const FONT = {
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  Y: ['#...#', '#...#', '#...#', '.#.#.', '.#.#.', '.#.#.', '.#.#.'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.']
}

function drawText (str, scale, cx, color, glowColor, glowStrength) {
  const cw = 5 * scale, ch = 7 * scale, gap = scale
  const width = str.length * cw + (str.length - 1) * gap
  let x0 = cx - Math.floor(width / 2)
  const y0 = 356 - Math.floor(ch / 2)
  for (let li = 0; li < str.length; li++) {
    const glyph = FONT[str[li]]
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] !== '#') continue
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = x0 + gx * scale + sx
            const py = y0 + gy * scale + sy
            if (glowStrength > 0) {
              for (const [ox, oy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
                blend(px + ox, py + oy, glowColor[0], glowColor[1], glowColor[2], glowStrength)
              }
            }
            blend(px, py, color[0], color[1], color[2], 255)
          }
        }
      }
    }
    x0 += cw + gap
  }
}

drawText('NIGHTLY', 9, SIZE / 2, PALETTE.text, [90, 100, 220], 45)
drawText('LAUNCHER', 4, SIZE / 2, PALETTE.textDim, [90, 100, 220], 30)

let crcTable = []
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c >>> 0
}
function crc32 (buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk (type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  img.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const out = path.join(__dirname, '..', 'splash.png')
fs.writeFileSync(out, png)
console.log('Wrote', out, png.length, 'bytes')
