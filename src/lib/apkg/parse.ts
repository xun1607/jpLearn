import { unzipSync } from 'fflate'
import { decompress as zstdDecompress } from 'fzstd'
import type { Database, SqlJsStatic } from 'sql.js'
import { collectMedia, isZstd, parseMediaMap } from './media'
import type {
  ParsedCard,
  ParsedCollection,
  ParsedDeck,
  ParsedNote,
  ParsedNotetype,
  ProgressFn,
} from './types'

/**
 * Parser `.apkg` — pure function, không đụng DOM, không đụng Dexie.
 * Chạy được cả trong Web Worker lẫn script Node (CLAUDE.md §3, §11).
 *
 * `SQL` là module sql.js ĐÃ khởi tạo — nơi gọi tự lo đường dẫn .wasm,
 * vì Node và Vite định vị file wasm khác nhau.
 */

/** Bẫy 2 (§6): bản Anki mới nhét `collection.anki2` GIẢ chỉ chứa 1 thẻ mồi. */
const DB_ENTRIES = ['collection.anki21b', 'collection.anki21', 'collection.anki2'] as const

const FIELD_SEPARATOR = '\x1f'

export function parseApkg(
  apkg: Uint8Array,
  SQL: SqlJsStatic,
  onProgress: ProgressFn = () => {},
): ParsedCollection {
  onProgress('Giải nén gói')
  const zip = unzipSync(apkg)

  const dbEntry = DB_ENTRIES.find((name) => zip[name])
  if (!dbEntry) {
    throw new Error('Không tìm thấy collection.anki2* trong gói — file này có phải .apkg không?')
  }

  onProgress('Mở cơ sở dữ liệu')
  let dbBytes = zip[dbEntry]
  if (isZstd(dbBytes)) dbBytes = zstdDecompress(dbBytes)

  const db = new SQL.Database(dbBytes)
  try {
    return readCollection(db, zip, dbEntry, onProgress)
  } finally {
    db.close()
  }
}

function readCollection(
  db: Database,
  zip: Record<string, Uint8Array>,
  dbEntry: string,
  onProgress: ProgressFn,
): ParsedCollection {
  const warnings: string[] = []

  onProgress('Đọc notetype và deck')
  let schema: 'v11' | 'v18' = 'v11'
  let notetypes = readNotetypesV11(db)
  let decks = readDecksV11(db)

  // §6 Bẫy 1: col.models rỗng nghĩa là schema v18.
  if (notetypes.length === 0) {
    schema = 'v18'
    notetypes = readNotetypesV18(db)
    if (notetypes.length > 0) {
      warnings.push(
        'Gói dùng schema v18: template (qfmt/afmt) nằm trong protobuf nên chưa đọc được. ' +
          'Nội dung và field vẫn nhập đủ; thẻ hiển thị dạng thô cho tới khi làm template engine.',
      )
    }
  }
  if (decks.length === 0) decks = readDecksV18(db)

  onProgress('Đọc note')
  const notes = readNotes(db, notetypes, warnings, onProgress)

  onProgress('Đọc card')
  const noteIds = new Set(notes.map((n) => n.id))
  const deckIds = new Set(decks.map((d) => d.id))
  const cards = readCards(db, noteIds, deckIds, decks, warnings)

  onProgress('Đọc media')
  const { map, warning } = parseMediaMap(zip['media'])
  if (warning) warnings.push(warning)
  const media = collectMedia(zip, map)

  return { schema, dbEntry, notetypes, decks, notes, cards, media, warnings }
}

// ---------------------------------------------------------------- sql.js helpers

function queryAll(db: Database, sql: string): unknown[][] {
  try {
    const stmt = db.prepare(sql)
    const rows: unknown[][] = []
    try {
      while (stmt.step()) rows.push(stmt.get() as unknown[])
    } finally {
      stmt.free()
    }
    return rows
  } catch {
    return [] // bảng không tồn tại ở schema kia
  }
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v ?? 0)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

// ---------------------------------------------------------------- schema v11

interface V11Model {
  id: number
  name: string
  css?: string
  flds?: { name: string; ord: number }[]
  tmpls?: { name: string; qfmt: string; afmt: string; ord: number }[]
}

function readNotetypesV11(db: Database): ParsedNotetype[] {
  const rows = queryAll(db, 'SELECT models FROM col LIMIT 1')
  const raw = str(rows[0]?.[0])
  if (!raw || raw === '{}') return []

  let parsed: Record<string, V11Model>
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  return Object.values(parsed).map((model) => ({
    id: num(model.id),
    name: model.name,
    css: model.css ?? '',
    fields: (model.flds ?? [])
      .slice()
      .sort((a, b) => a.ord - b.ord)
      .map((f) => f.name),
    templates: (model.tmpls ?? [])
      .slice()
      .sort((a, b) => a.ord - b.ord)
      .map((t) => ({ name: t.name, qfmt: t.qfmt ?? '', afmt: t.afmt ?? '' })),
  }))
}

function readDecksV11(db: Database): ParsedDeck[] {
  const rows = queryAll(db, 'SELECT decks FROM col LIMIT 1')
  const raw = str(rows[0]?.[0])
  if (!raw || raw === '{}') return []
  try {
    const parsed = JSON.parse(raw) as Record<string, { id: number; name: string }>
    return Object.values(parsed).map((d) => ({ id: num(d.id), name: normalizeDeckName(d.name) }))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------- schema v18
//
// Sai lệch có chủ đích so với §6 (đã duyệt): §6 bảo từ chối v18, nhưng rào cản
// thật sự chỉ là qfmt/afmt nằm trong protobuf. Bản text-only hôm nay không dùng
// tới chúng, mà mọi thứ nó cần ở v18 đều là cột text thường.

function readNotetypesV18(db: Database): ParsedNotetype[] {
  const notetypeRows = queryAll(db, 'SELECT id, name FROM notetypes ORDER BY id')
  if (notetypeRows.length === 0) return []

  const fieldsByNotetype = groupByNotetype(
    queryAll(db, 'SELECT ntid, ord, name FROM fields ORDER BY ntid, ord'),
  )
  const templatesByNotetype = groupByNotetype(
    queryAll(db, 'SELECT ntid, ord, name FROM templates ORDER BY ntid, ord'),
  )

  return notetypeRows.map(([id, name]) => {
    const key = num(id)
    const templates = templatesByNotetype.get(key) ?? []
    return {
      id: key,
      name: str(name),
      css: '',
      fields: (fieldsByNotetype.get(key) ?? []).map((f) => f.name),
      // qfmt/afmt ở protobuf — để rỗng, bước 3 của lộ trình mới cần.
      templates: (templates.length > 0 ? templates : [{ ord: 0, name: 'Thẻ 1' }]).map((t) => ({
        name: t.name,
        qfmt: '',
        afmt: '',
      })),
    }
  })
}

function groupByNotetype(rows: unknown[][]): Map<number, { ord: number; name: string }[]> {
  const out = new Map<number, { ord: number; name: string }[]>()
  for (const [ntid, ord, name] of rows) {
    const key = num(ntid)
    const list = out.get(key) ?? []
    list.push({ ord: num(ord), name: str(name) })
    out.set(key, list)
  }
  for (const list of out.values()) list.sort((a, b) => a.ord - b.ord)
  return out
}

function readDecksV18(db: Database): ParsedDeck[] {
  return queryAll(db, 'SELECT id, name FROM decks ORDER BY id').map(([id, name]) => ({
    id: num(id),
    name: normalizeDeckName(str(name)),
  }))
}

/** v11 phân cấp bằng "::", v18 bằng \x1f — quy về một kiểu. */
function normalizeDeckName(name: string): string {
  return name.split(FIELD_SEPARATOR).join('::') || 'Không tên'
}

// ---------------------------------------------------------------- notes & cards

function readNotes(
  db: Database,
  notetypes: ParsedNotetype[],
  warnings: string[],
  onProgress: ProgressFn,
): ParsedNote[] {
  const known = new Set(notetypes.map((nt) => nt.id))
  const rows = queryAll(db, 'SELECT id, guid, mid, flds, tags FROM notes')
  const notes: ParsedNote[] = []
  let skipped = 0

  rows.forEach(([id, guid, mid, flds, tags], i) => {
    const notetypeId = num(mid)
    if (!known.has(notetypeId)) {
      skipped++
      return
    }
    notes.push({
      id: num(id),
      guid: str(guid),
      notetypeId,
      // §6 bước 4: các field nhồi chung một chuỗi, ngăn bằng \x1f
      fields: str(flds).split(FIELD_SEPARATOR),
      tags: str(tags).trim().split(/\s+/).filter(Boolean),
    })
    if (i % 2000 === 0) onProgress('Đọc note', i, rows.length)
  })

  if (skipped > 0) warnings.push(`Bỏ qua ${skipped} note không khớp notetype nào.`)
  return notes
}

function readCards(
  db: Database,
  noteIds: Set<number>,
  deckIds: Set<number>,
  decks: ParsedDeck[],
  warnings: string[],
): ParsedCard[] {
  const rows = queryAll(db, 'SELECT id, nid, did, odid, ord FROM cards')
  const cards: ParsedCard[] = []
  let orphans = 0
  let rehomed = 0

  // Deck dự phòng cho card trỏ tới deck không tồn tại.
  let fallbackDeck = decks[0]?.id
  if (fallbackDeck === undefined) {
    fallbackDeck = 1
    decks.push({ id: 1, name: 'Đã nhập' })
    deckIds.add(1)
  }

  for (const [id, nid, did, odid, ord] of rows) {
    const noteId = num(nid)
    if (!noteIds.has(noteId)) {
      orphans++
      continue
    }
    // odid != 0 nghĩa là card đang nằm trong deck lọc; deck thật là odid.
    const original = num(odid)
    let deckId = original !== 0 ? original : num(did)
    if (!deckIds.has(deckId)) {
      deckId = fallbackDeck
      rehomed++
    }
    cards.push({ id: num(id), noteId, deckId, ord: num(ord) })
  }

  if (orphans > 0) warnings.push(`Bỏ qua ${orphans} card không có note.`)
  if (rehomed > 0) warnings.push(`${rehomed} card trỏ tới deck không tồn tại, đã dồn về deck đầu.`)
  return cards
}
