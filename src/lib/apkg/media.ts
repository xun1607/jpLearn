import { decompress as zstdDecompress } from 'fzstd'
import type { ParsedMedia } from './types'

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

export function isZstd(bytes: Uint8Array): boolean {
  return ZSTD_MAGIC.every((b, i) => bytes[i] === b)
}

/**
 * File ánh xạ `media` có ba dạng ngoài đời:
 *   1. JSON thường          {"0": "neko.jpg", "1": "kane.mp3"}   (.anki2 / .anki21)
 *   2. zstd bọc JSON
 *   3. zstd bọc protobuf    MediaEntries                          (.anki21b)
 * Gói mới nhất dùng dạng 3 — CLAUDE.md §6 chỉ nói tới dạng 1.
 */
export function parseMediaMap(raw: Uint8Array | undefined): {
  /** tên file trong zip -> tên thật */
  map: Map<string, string>
  warning?: string
} {
  if (!raw || raw.length === 0) return { map: new Map() }

  const bytes = isZstd(raw) ? zstdDecompress(raw) : raw

  const asJson = tryJson(bytes)
  if (asJson) return { map: asJson }

  try {
    return { map: parseMediaProtobuf(bytes) }
  } catch (err) {
    return { map: new Map(), warning: `Không đọc được danh sách media: ${String(err)}` }
  }
}

function tryJson(bytes: Uint8Array): Map<string, string> | null {
  if (bytes[0] !== 0x7b) return null // '{'
  try {
    const obj = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>
    return new Map(Object.entries(obj))
  } catch {
    return null
  }
}

/**
 * Bộ đọc protobuf tối thiểu, chỉ đủ cho:
 *   MediaEntries { repeated MediaEntry entries = 1 }
 *   MediaEntry   { string name = 1; uint32 size = 2; bytes sha1 = 3 }
 * Thứ tự entry chính là tên file số trong zip: entry thứ 0 -> file "0".
 */
function parseMediaProtobuf(bytes: Uint8Array): Map<string, string> {
  const map = new Map<string, string>()
  let index = 0
  let pos = 0

  while (pos < bytes.length) {
    const [tag, afterTag] = readVarint(bytes, pos)
    const field = tag >>> 3
    const wire = tag & 7
    pos = afterTag

    if (field === 1 && wire === 2) {
      const [len, afterLen] = readVarint(bytes, pos)
      const entry = bytes.subarray(afterLen, afterLen + len)
      const name = readEntryName(entry)
      if (name !== null) map.set(String(index), name)
      index++
      pos = afterLen + len
    } else {
      pos = skipField(bytes, pos, wire)
    }
  }
  return map
}

function readEntryName(entry: Uint8Array): string | null {
  let pos = 0
  while (pos < entry.length) {
    const [tag, afterTag] = readVarint(entry, pos)
    const field = tag >>> 3
    const wire = tag & 7
    pos = afterTag
    if (field === 1 && wire === 2) {
      const [len, afterLen] = readVarint(entry, pos)
      return new TextDecoder().decode(entry.subarray(afterLen, afterLen + len))
    }
    pos = skipField(entry, pos, wire)
  }
  return null
}

function readVarint(bytes: Uint8Array, pos: number): [number, number] {
  let result = 0
  let shift = 0
  while (pos < bytes.length) {
    const byte = bytes[pos++]
    result += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) return [result, pos]
    shift += 7
    if (shift > 63) throw new Error('varint quá dài')
  }
  throw new Error('varint bị cắt cụt')
}

function skipField(bytes: Uint8Array, pos: number, wire: number): number {
  switch (wire) {
    case 0:
      return readVarint(bytes, pos)[1]
    case 1:
      return pos + 8
    case 2: {
      const [len, after] = readVarint(bytes, pos)
      return after + len
    }
    case 5:
      return pos + 4
    default:
      throw new Error(`wire type không hỗ trợ: ${wire}`)
  }
}

/** Ghép map với các file số trong zip -> danh sách media theo TÊN THẬT (§6). */
export function collectMedia(
  zip: Record<string, Uint8Array>,
  map: Map<string, string>,
): ParsedMedia[] {
  const out: ParsedMedia[] = []
  for (const [numbered, realName] of map) {
    const data = zip[numbered]
    if (data) out.push({ name: realName, data })
  }
  return out
}
