/**
 * Sinh icon PWA (192/512 + apple-touch-icon 180) mà không cần thư viện ảnh.
 * Hình: nền slate đậm, hai thẻ trắng xếp chồng lệch nhau.
 *
 *   node scripts/make-icons.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { zlibSync } from 'fflate'

const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'public')

const BG = [15, 23, 42] // #0f172a
const CARD_BACK = [100, 116, 139] // #64748b
const CARD_FRONT = [248, 250, 252] // #f8fafc
const ACCENT = [16, 185, 129] // #10b981

/** Khoảng cách có dấu tới hình chữ nhật bo góc, dùng để khử răng cưa. */
function roundedRectSdf(x, y, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(x - cx) - (halfW - radius)
  const dy = Math.abs(y - cy) - (halfH - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - radius
}

function blend(dst, i, color, alpha) {
  if (alpha <= 0) return
  for (let c = 0; c < 3; c++) {
    dst[i + c] = Math.round(dst[i + c] * (1 - alpha) + color[c] * alpha)
  }
}

function render(size) {
  const px = new Uint8Array(size * size * 4)
  const s = size / 512 // thiết kế ở 512 rồi co lại

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      px[i] = BG[0]
      px[i + 1] = BG[1]
      px[i + 2] = BG[2]
      px[i + 3] = 255

      const cx = x + 0.5
      const cy = y + 0.5

      // thẻ sau: lệch lên phải, xoay bằng cách dịch tâm
      const back = roundedRectSdf(cx, cy, 276 * s, 206 * s, 118 * s, 88 * s, 22 * s)
      blend(px, i, CARD_BACK, coverage(back))

      // thẻ trước
      const front = roundedRectSdf(cx, cy, 236 * s, 296 * s, 134 * s, 100 * s, 26 * s)
      blend(px, i, CARD_FRONT, coverage(front))

      // vạch xanh dưới thẻ trước
      const bar = roundedRectSdf(cx, cy, 236 * s, 344 * s, 96 * s, 11 * s, 11 * s)
      blend(px, i, ACCENT, coverage(bar))

      // hai dòng "chữ" trên thẻ trước
      const line1 = roundedRectSdf(cx, cy, 236 * s, 268 * s, 86 * s, 13 * s, 13 * s)
      blend(px, i, BG, coverage(line1))
      const line2 = roundedRectSdf(cx, cy, 236 * s, 308 * s, 56 * s, 11 * s, 11 * s)
      blend(px, i, BG, coverage(line2))
    }
  }
  return px
}

function coverage(sdf) {
  return Math.min(1, Math.max(0, 0.5 - sdf))
}

// ------------------------------------------------------------------ PNG writer

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBytes = new TextEncoder().encode(type)
  const body = new Uint8Array(typeBytes.length + data.length)
  body.set(typeBytes)
  body.set(data, typeBytes.length)

  // 4 byte độ dài + (type + data) + 4 byte CRC
  const out = new Uint8Array(4 + body.length + 4)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(body, 4)
  view.setUint32(4 + body.length, crc32(body))
  return out
}

function toPng(px, size) {
  // lọc kiểu 0 (None) cho mỗi dòng
  const raw = new Uint8Array(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    raw.set(px.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1)
  }

  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, size)
  view.setUint32(4, size)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour + alpha
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const png = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    png.set(p, offset)
    offset += p.length
  }
  return png
}

mkdirSync(outDir, { recursive: true })
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  const file = path.join(outDir, name)
  writeFileSync(file, toPng(render(size), size))
  console.log(`  ${name} (${size}x${size})`)
}
