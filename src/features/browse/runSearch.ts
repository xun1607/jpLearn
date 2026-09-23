import { db } from '../../db'
import type { CardRow, Note, NoteType } from '../../db/schema'
import {
  matchesCard,
  matchesNote,
  needsNoteScan,
  noteHaystack,
  parseQuery,
  type Query,
} from './search'

export interface BrowseRow {
  card: CardRow
  note: Note
  notetype: NoteType | undefined
  deckName: string
  /** nội dung field đầu, đã bỏ HTML — dùng làm dòng tiêu đề */
  title: string
  /** các field còn lại gộp lại, cắt ngắn */
  preview: string
}

export interface SearchResult {
  rows: BrowseRow[]
  /** tổng số khớp, có thể lớn hơn rows.length */
  total: number
  truncated: boolean
  query: Query
}

/** Số dòng hiện ra. Nhiều hơn thì cuộn mỏi tay mà chẳng ai đọc. */
export const PAGE_SIZE = 200

/** Trần quét note, chặn trường hợp bộ 20k thẻ làm treo máy. */
const NOTE_SCAN_CAP = 5000

export async function runSearch(input: string, limit = PAGE_SIZE): Promise<SearchResult> {
  const query = parseQuery(input)
  const now = new Date()

  const decks = await db.decks.toArray()
  const deckNames = new Map(decks.map((d) => [d.id, d.name]))

  // Hai pha. Pha 1 chỉ lọc, KHÔNG nạp nội dung note trừ khi buộc phải đọc để
  // lọc. Pha 2 mới nạp note — và chỉ nạp đúng số dòng sắp hiện ra.
  //
  // Bản đầu nạp note cho mọi thẻ khớp: bộ 7065 thẻ là 3787 lượt đọc cho một
  // trang 200 dòng, đủ để treo máy.
  let cards: CardRow[]
  let preloaded: Map<number, Note> | null = null

  if (needsNoteScan(query)) {
    const notes: Note[] = []
    await db.notes.each((note) => {
      if (notes.length >= NOTE_SCAN_CAP) return
      if (matchesNote(note, query, noteHaystack(note))) notes.push(note)
    })
    preloaded = new Map(notes.map((n) => [n.id, n]))
    cards = await db.cards
      .where('noteId')
      .anyOf(notes.map((n) => n.id))
      .toArray()
  } else {
    // Không lọc gì thuộc về note -> khỏi đụng bảng notes ở pha này.
    const deckIds =
      query.decks.length > 0
        ? decks
            .filter((d) => query.decks.some((q) => d.name.toLowerCase().includes(q)))
            .map((d) => d.id)
        : null

    cards = deckIds === null ? await db.cards.toArray() : await cardsInDecks(deckIds)
  }

  const matched = cards.filter((card) =>
    matchesCard(card, deckNames.get(card.deckId) ?? '', query, now),
  )
  matched.sort((a, b) => a.noteId - b.noteId || a.ord - b.ord)

  const page = matched.slice(0, limit)

  // Chỉ tới đây mới nạp note, và chỉ cho đúng trang đang hiện.
  const notesById = preloaded ?? new Map<number, Note>()
  if (!preloaded) {
    const ids = [...new Set(page.map((c) => c.noteId))]
    for (const note of await db.notes.bulkGet(ids)) {
      if (note) notesById.set(note.id, note)
    }
  }

  const notetypeIds = [
    ...new Set(
      page.map((c) => notesById.get(c.noteId)?.notetypeId).filter((id): id is number => id !== undefined),
    ),
  ]
  const notetypes = new Map(
    (await db.notetypes.bulkGet(notetypeIds))
      .filter((nt): nt is NoteType => nt !== undefined)
      .map((nt) => [nt.id, nt]),
  )

  const rows: BrowseRow[] = []
  for (const card of page) {
    const note = notesById.get(card.noteId)
    if (!note) continue // note đã bị xoá mà thẻ còn sót
    rows.push({
      card,
      note,
      notetype: notetypes.get(note.notetypeId),
      deckName: deckNames.get(card.deckId) ?? '(deck đã xoá)',
      title: plain(note.fields[0] ?? '') || '(trống)',
      preview: note.fields.slice(1).map(plain).filter(Boolean).join(' · ').slice(0, 160),
    })
  }

  return { rows, total: matched.length, truncated: matched.length > page.length, query }
}

/**
 * Lấy thẻ của nhiều deck bằng nhiều lần `equals`, KHÔNG dùng `anyOf`.
 *
 * Đo thật trên bộ 7065 thẻ: `where('deckId').anyOf([id])` mất 67 GIÂY, còn
 * `equals(id)` mất 0,2 giây. `anyOf` tối ưu cho "vài khoá, mỗi khoá ít hàng";
 * ở đây là một khoá ứng với cả bảng nên nó dò lại index cho từng hàng.
 */
export async function cardsInDecks(deckIds: number[]): Promise<CardRow[]> {
  const perDeck = await Promise.all(
    deckIds.map((id) => db.cards.where('deckId').equals(id).toArray()),
  )
  return perDeck.flat()
}

function plain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\[sound:[^\]]*\]/g, '🔊')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}
