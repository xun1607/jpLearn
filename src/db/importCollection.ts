import { createEmptyCard } from 'ts-fsrs'
import type { ParsedCollection } from '../lib/apkg/types'
import { db, newId } from './index'
import type { CardRow, Deck, Note, NoteType } from './schema'

export interface ImportSummary {
  schema: 'v11' | 'v18'
  decks: string[]
  notes: number
  newCards: number
  keptCards: number
  media: number
  warnings: string[]
}

/** Anki cấp id theo epoch-ms. Id nhỏ hơn mốc này là id cố định kiểu cũ (vd deck 1). */
const EPOCH_MS_ID_FLOOR = 1_000_000_000_000

const CHUNK = 1000

export async function importCollection(
  col: ParsedCollection,
  onProgress: (phase: string, done?: number, total?: number) => void = () => {},
): Promise<ImportSummary> {
  const warnings = [...col.warnings]

  // Deck không có card nào (thường là "Default" rỗng) chỉ làm rác danh sách,
  // mà id 1 của nó còn đụng deck mặc định của app.
  const cardCountByDeck = new Map<number, number>()
  for (const card of col.cards) {
    cardCountByDeck.set(card.deckId, (cardCountByDeck.get(card.deckId) ?? 0) + 1)
  }

  // Id kiểu cũ (nhỏ) có thể đụng dữ liệu sẵn có -> cấp id mới.
  const deckIdMap = new Map<number, number>()
  const decks: Deck[] = []
  for (const deck of col.decks) {
    if ((cardCountByDeck.get(deck.id) ?? 0) === 0) continue
    const id = deck.id >= EPOCH_MS_ID_FLOOR ? deck.id : newId()
    deckIdMap.set(deck.id, id)
    decks.push({ id, name: deck.name })
  }

  const notetypeIdMap = new Map<number, number>()
  const notetypes: NoteType[] = col.notetypes.map((nt) => {
    const id = nt.id >= EPOCH_MS_ID_FLOOR ? nt.id : newId()
    notetypeIdMap.set(nt.id, id)
    return {
      id,
      name: nt.name,
      fields: nt.fields,
      css: nt.css,
      templates: nt.templates,
    }
  })

  const notes: Note[] = col.notes.map((note) => ({
    id: note.id,
    notetypeId: notetypeIdMap.get(note.notetypeId) ?? note.notetypeId,
    guid: note.guid,
    fields: note.fields,
    tags: note.tags,
  }))

  // Bẫy 3 (§6): chỉ nhập nội dung, mọi thẻ vào ở trạng thái `new`.
  // Không cố chuyển ivl/factor của SM-2 sang stability/difficulty của FSRS.
  const now = new Date()
  const candidates: CardRow[] = []
  for (const card of col.cards) {
    const deckId = deckIdMap.get(card.deckId)
    if (deckId === undefined) continue
    candidates.push({
      ...createEmptyCard(now),
      id: card.id,
      noteId: card.noteId,
      deckId,
      ord: card.ord,
      suspended: 0,
    })
  }

  // Nhập lại cùng một gói không được xoá tiến độ đã học: card nào đã có thì giữ.
  onProgress('Đối chiếu thẻ đã có')
  const existing = new Set<number>()
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const slice = candidates.slice(i, i + CHUNK)
    const found = await db.cards.bulkGet(slice.map((c) => c.id))
    found.forEach((row, j) => {
      if (row) existing.add(slice[j].id)
    })
  }
  const newCards = candidates.filter((c) => !existing.has(c.id))

  onProgress('Ghi vào máy', 0, notes.length + newCards.length)
  await db.transaction('rw', db.notetypes, db.decks, db.notes, db.cards, async () => {
    await db.notetypes.bulkPut(notetypes)
    await db.decks.bulkPut(decks)
    let done = 0
    for (let i = 0; i < notes.length; i += CHUNK) {
      await db.notes.bulkPut(notes.slice(i, i + CHUNK))
      done += Math.min(CHUNK, notes.length - i)
      onProgress('Ghi vào máy', done, notes.length + newCards.length)
    }
    for (let i = 0; i < newCards.length; i += CHUNK) {
      await db.cards.bulkPut(newCards.slice(i, i + CHUNK))
      done += Math.min(CHUNK, newCards.length - i)
      onProgress('Ghi vào máy', done, notes.length + newCards.length)
    }
  })

  // Media chưa render ở bản này (bước 3 của lộ trình), nhưng lưu sẵn theo TÊN
  // THẬT để lúc đó khỏi phải nhập lại gói.
  if (col.media.length > 0) {
    onProgress('Lưu media', 0, col.media.length)
    for (let i = 0; i < col.media.length; i += 200) {
      const slice = col.media.slice(i, i + 200)
      await db.media.bulkPut(
        slice.map((m) => ({ name: m.name, blob: new Blob([m.data as BlobPart]) })),
      )
      onProgress('Lưu media', Math.min(i + 200, col.media.length), col.media.length)
    }
  }

  if (existing.size > 0) {
    warnings.push(`${existing.size} thẻ đã có sẵn — giữ nguyên tiến độ học, không ghi đè.`)
  }

  return {
    schema: col.schema,
    decks: decks.map((d) => d.name),
    notes: notes.length,
    newCards: newCards.length,
    keptCards: existing.size,
    media: col.media.length,
    warnings,
  }
}
