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

/**
 * Hàng đợi một phiên ôn: thẻ tới hạn + thẻ mới trong hạn mức ngày.
 * Trả CardRow đầy đủ; note nạp riêng từng thẻ để deck 20k không phải load hết.
 */
export async function buildQueue(
  deckId: number,
  newPerDay: number = DEFAULT_NEW_PER_DAY,
): Promise<CardRow[]> {
  const now = new Date()
  const dueRaw = await db.cards
    .where('[deckId+due]')
    .between([deckId, Dexie.minKey], [deckId, now], true, true)
    .toArray()
  const due = dueRaw.filter((c) => c.state !== State.New && !c.suspended)

  const remaining = Math.max(0, newPerDay - (await newIntroducedToday()))
  const fresh =
    remaining === 0
      ? []
      : (
          await db.cards
            .where('[deckId+state]')
            .equals([deckId, State.New])
            .limit(remaining)
            .toArray()
        ).filter((c) => !c.suspended)

  return interleave(shuffle(due), fresh)
}
