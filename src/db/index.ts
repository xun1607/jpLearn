import Dexie, { type EntityTable } from 'dexie'
import { createEmptyCard } from 'ts-fsrs'
import type {
  CardRow,
  ConfigRow,
  Deck,
  MediaRow,
  Note,
  NoteType,
  RevlogRow,
} from './schema'

export class FlashcardDB extends Dexie {
  notetypes!: EntityTable<NoteType, 'id'>
  decks!: EntityTable<Deck, 'id'>
  notes!: EntityTable<Note, 'id'>
  cards!: EntityTable<CardRow, 'id'>
  revlog!: EntityTable<RevlogRow, 'id'>
  media!: EntityTable<MediaRow, 'name'>
  config!: EntityTable<ConfigRow, 'key'>

  constructor() {
    super('flashcards')
    this.version(1).stores({
      notetypes: 'id, name',
      decks: 'id, name',
      notes: 'id, notetypeId, guid, *tags',
      // §4: index cần cho màn ôn
      cards: 'id, noteId, deckId, due, [deckId+due], [deckId+state]',
      revlog: '++id, cardId, reviewedAt',
      media: 'name',
      config: 'key',
    })
  }
}

export const db = new FlashcardDB()

/** Anki dùng epoch-ms làm id. Giữ nguyên quy ước, chống đụng bằng bộ đếm. */
let lastId = 0
export function newId(): number {
  const now = Date.now()
  lastId = now > lastId ? now : lastId + 1
  return lastId
}

export const BASIC_NOTETYPE_ID = 1
export const DEFAULT_DECK_ID = 1

/** Seed notetype + deck mặc định để mở app là gõ thẻ được ngay. */
export async function seedIfEmpty(): Promise<void> {
  const hasNotetype = await db.notetypes.get(BASIC_NOTETYPE_ID)
  if (!hasNotetype) {
    await db.notetypes.put({
      id: BASIC_NOTETYPE_ID,
      name: 'Cơ bản',
      fields: ['Mặt trước', 'Mặt sau'],
      css: '',
      templates: [
        { name: 'Thẻ 1', qfmt: '{{Mặt trước}}', afmt: '{{FrontSide}}<hr id=answer>{{Mặt sau}}' },
      ],
    })
  }
  const hasDeck = await db.decks.get(DEFAULT_DECK_ID)
  if (!hasDeck) {
    await db.decks.put({ id: DEFAULT_DECK_ID, name: 'Mặc định' })
  }
}

/** Thêm một note gõ tay + sinh card cho từng template của notetype. */
export async function addNote(
  deckId: number,
  notetypeId: number,
  fields: string[],
  tags: string[] = [],
): Promise<void> {
  const notetype = await db.notetypes.get(notetypeId)
  if (!notetype) throw new Error(`Không tìm thấy notetype ${notetypeId}`)

  const noteId = newId()
  const now = new Date()
  const cards: CardRow[] = notetype.templates.map((_, ord) => ({
    ...createEmptyCard(now),
    id: newId(),
    noteId,
    deckId,
    ord,
    suspended: 0 as const,
  }))

  await db.transaction('rw', db.notes, db.cards, async () => {
    await db.notes.put({
      id: noteId,
      notetypeId,
      guid: crypto.randomUUID(),
      fields,
      tags,
    })
    await db.cards.bulkPut(cards)
  })
}

export async function getConfig<T>(key: string, fallback: T): Promise<T> {
  const row = await db.config.get(key)
  return row === undefined ? fallback : (row.value as T)
}

export async function setConfig(key: string, value: unknown): Promise<void> {
  await db.config.put({ key, value })
}
