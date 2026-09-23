import { db } from './index'

export interface DeleteSummary {
  decks: string[]
  cards: number
  notes: number
  revlog: number
}

const CHUNK = 500

/**
 * Xoá deck cùng toàn bộ thẻ, revlog, và những note không còn thẻ nào.
 *
 * Deck con bị xoá theo: tên deck phân cấp bằng "::" nhưng mỗi cấp là một hàng
 * riêng, xoá mỗi deck cha sẽ để lại đám con mồ côi trong danh sách.
 *
 * Note chỉ bị xoá khi KHÔNG còn thẻ nào trỏ tới — một note có thể sinh nhiều
 * thẻ nằm ở nhiều deck khác nhau, xoá theo deck mà đụng luôn note là mất dữ
 * liệu ở deck còn lại.
 */
export async function deleteDeck(deckId: number): Promise<DeleteSummary> {
  const root = await db.decks.get(deckId)
  if (!root) return { decks: [], cards: 0, notes: 0, revlog: 0 }

  const all = await db.decks.toArray()
  const targets = all.filter((d) => d.id === deckId || d.name.startsWith(`${root.name}::`))
  const targetIds = targets.map((d) => d.id)

  const cards = await db.cards.where('deckId').anyOf(targetIds).toArray()
  const cardIds = cards.map((c) => c.id)
  const noteIds = [...new Set(cards.map((c) => c.noteId))]

  let revlogDeleted = 0

  await db.transaction('rw', db.cards, db.notes, db.revlog, db.decks, async () => {
    for (const slice of chunks(cardIds)) {
      revlogDeleted += await db.revlog.where('cardId').anyOf(slice).delete()
      await db.cards.bulkDelete(slice)
    }

    // Sau khi thẻ đã biến mất, note nào không còn thẻ nào thì mới xoá.
    const orphans: number[] = []
    for (const slice of chunks(noteIds)) {
      const survivors = await db.cards.where('noteId').anyOf(slice).toArray()
      const stillUsed = new Set(survivors.map((c) => c.noteId))
      orphans.push(...slice.filter((id) => !stillUsed.has(id)))
    }
    for (const slice of chunks(orphans)) {
      await db.notes.bulkDelete(slice)
    }

    await db.decks.bulkDelete(targetIds)

    return orphans.length
  })

  const remainingNotes = await countRemaining(noteIds)

  return {
    decks: targets.map((d) => d.name),
    cards: cardIds.length,
    notes: noteIds.length - remainingNotes,
    revlog: revlogDeleted,
  }
}

async function countRemaining(noteIds: number[]): Promise<number> {
  let n = 0
  for (const slice of chunks(noteIds)) {
    n += await db.notes.where('id').anyOf(slice).count()
  }
  return n
}

function* chunks<T>(items: T[]): Generator<T[]> {
  for (let i = 0; i < items.length; i += CHUNK) yield items.slice(i, i + CHUNK)
}
