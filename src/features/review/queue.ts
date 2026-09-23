import Dexie from 'dexie'
import { State } from 'ts-fsrs'
import { db } from '../../db'
import type { CardRow } from '../../db/schema'

export const DEFAULT_NEW_PER_DAY = 20

function startOfToday(now = new Date()): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}

async function cardsStudiedToday(): Promise<CardRow[]> {
  const logs = await db.revlog.where('reviewedAt').aboveOrEqual(startOfToday()).toArray()
  const ids = [...new Set(logs.map((l) => l.cardId))]
  if (ids.length === 0) return []
  const rows = await db.cards.bulkGet(ids)
  return rows.filter((r): r is CardRow => r !== undefined)
}

/**
 * Số thẻ mới đã học hôm nay, suy từ revlog: `state` trong revlog là trạng thái
 * TRƯỚC khi ôn, nên state === New nghĩa là thẻ đó lần đầu ra mắt.
 * Không cần bộ đếm riêng, không sợ lệch khi đổi múi giờ.
 */
export async function newIntroducedToday(): Promise<number> {
  const logs = await db.revlog.where('reviewedAt').aboveOrEqual(startOfToday()).toArray()
  const seen = new Set<number>()
  for (const log of logs) {
    if (log.state === State.New) seen.add(log.cardId)
  }
  return seen.size
}

/**
 * Note đã học hôm nay — dùng để "chôn" thẻ anh em.
 *
 * Một note sinh nhiều thẻ (kanji→nghĩa và nghĩa→kanji). Học thẻ đầu xong mà
 * thẻ sau hỏi đúng từ đó thì đáp án còn nguyên trong đầu, FSRS đo được độ nhớ
 * giả chứ không phải độ nhớ thật. Anki gọi việc hoãn này là bury sibling.
 */
export async function notesStudiedToday(): Promise<Set<number>> {
  return new Set((await cardsStudiedToday()).map((c) => c.noteId))
}

export async function deckCounts(deckId: number): Promise<{ due: number; new: number }> {
  const now = new Date()
  const [dueCards, newCount] = await Promise.all([
    db.cards
      .where('[deckId+due]')
      .between([deckId, Dexie.minKey], [deckId, now], true, true)
      .toArray(),
    db.cards.where('[deckId+state]').equals([deckId, State.New]).count(),
  ])
  return {
    due: dueCards.filter((c) => c.state !== State.New && !c.suspended).length,
    new: newCount,
  }
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Trộn đều thẻ mới vào giữa thẻ tới hạn, không xen kẽ phức tạp. */
function interleave(due: CardRow[], fresh: CardRow[]): CardRow[] {
  if (fresh.length === 0) return due
  if (due.length === 0) return fresh
  const out: CardRow[] = []
  const step = due.length / fresh.length
  let nextNew = 0
  for (let i = 0; i < due.length; i++) {
    while (nextNew < fresh.length && nextNew * step <= i) {
      out.push(fresh[nextNew++])
    }
    out.push(due[i])
  }
  while (nextNew < fresh.length) out.push(fresh[nextNew++])
  return out
}

/** Mỗi note chỉ để lại một thẻ trong phiên; thẻ đứng trước được giữ. */
export function keepOnePerNote(cards: CardRow[], alreadySeen = new Set<number>()): CardRow[] {
  const seen = new Set(alreadySeen)
  const out: CardRow[] = []
  for (const card of cards) {
    if (seen.has(card.noteId)) continue
    seen.add(card.noteId)
    out.push(card)
  }
  return out
}

/**
 * Hàng đợi một phiên ôn: thẻ tới hạn + thẻ mới trong hạn mức ngày, đã chôn
 * thẻ anh em. Trả CardRow đầy đủ; note nạp riêng từng thẻ để deck 20k không
 * phải load hết.
 */
export async function buildQueue(
  deckId: number,
  newPerDay: number = DEFAULT_NEW_PER_DAY,
): Promise<CardRow[]> {
  const now = new Date()
  // Note đã học hôm nay chiếm sẵn chỗ -> thẻ anh em của chúng bị bỏ qua.
  const claimed = await notesStudiedToday()

  const dueRaw = await db.cards
    .where('[deckId+due]')
    .between([deckId, Dexie.minKey], [deckId, now], true, true)
    .toArray()
  const due = keepOnePerNote(
    shuffle(dueRaw.filter((c) => c.state !== State.New && !c.suspended)),
    claimed,
  )
  // Thẻ tới hạn giành chỗ trước thẻ mới: ôn cái đã quên quan trọng hơn học mới.
  for (const card of due) claimed.add(card.noteId)

  const remaining = Math.max(0, newPerDay - (await newIntroducedToday()))
  const fresh = remaining === 0 ? [] : await pickNewCards(deckId, remaining, claimed)

  return interleave(due, fresh)
}

const PAGE = 200

/**
 * Quét thẻ mới theo trang cho tới khi đủ `wanted` note khác nhau.
 *
 * Không lấy một phát `limit(wanted)` rồi lọc: notetype nhiều template thì cả
 * trang có thể là thẻ anh em của vài note, lọc xong còn lại dúm dó và hôm đó
 * học hụt hẳn hạn mức.
 */
async function pickNewCards(
  deckId: number,
  wanted: number,
  claimed: Set<number>,
): Promise<CardRow[]> {
  const picked: CardRow[] = []
  let offset = 0

  while (picked.length < wanted) {
    const page = await db.cards
      .where('[deckId+state]')
      .equals([deckId, State.New])
      .offset(offset)
      .limit(PAGE)
      .toArray()
    if (page.length === 0) break
    offset += page.length

    for (const card of page) {
      if (card.suspended || claimed.has(card.noteId)) continue
      claimed.add(card.noteId)
      picked.push(card)
      if (picked.length >= wanted) break
    }
  }
  return picked
}
