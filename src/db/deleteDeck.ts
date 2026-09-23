import { db } from './index'
import type { CardRow } from './schema'

export interface DeleteSummary {
  decks: string[]
  cards: number
  notes: number
  revlog: number
}

const CHUNK = 1000

/**
 * Xoá deck cùng toàn bộ thẻ, revlog, và những note không còn thẻ nào.
 *
 * Deck con bị xoá theo: tên deck phân cấp bằng "::" nhưng mỗi cấp là một hàng
 * riêng, xoá mỗi deck cha sẽ để lại đám con mồ côi trong danh sách.
 *
 * Note chỉ bị xoá khi KHÔNG còn thẻ nào trỏ tới — một note có thể sinh nhiều
 * thẻ nằm ở nhiều deck khác nhau, xoá theo deck mà đụng luôn note là mất dữ
 * liệu ở deck còn lại.
 *
 * Mọi thứ ở đây đi theo lối "quét một lượt" thay vì gọi `anyOf` với hàng nghìn
 * khoá: đo trên bộ 7065 thẻ thì `anyOf` chậm hơn hàng trăm lần.
 */
export async function deleteDeck(deckId: number): Promise<DeleteSummary> {
  const root = await db.decks.get(deckId)
  if (!root) return { decks: [], cards: 0, notes: 0, revlog: 0 }

  const all = await db.decks.toArray()
  const targets = all.filter((d) => d.id === deckId || d.name.startsWith(`${root.name}::`))
  const targetIds = new Set(targets.map((d) => d.id))

  const doomed: CardRow[] = []
  for (const id of targetIds) {
    doomed.push(...(await db.cards.where('deckId').equals(id).toArray()))
  }
  const doomedCardIds = new Set(doomed.map((c) => c.id))
  const touchedNotes = new Set(doomed.map((c) => c.noteId))

  let revlogDeleted = 0
  let notesDeleted = 0

  await db.transaction('rw', db.cards, db.notes, db.revlog, db.decks, async () => {
    const ids = [...doomedCardIds]
    for (let i = 0; i < ids.length; i += CHUNK) {
      await db.cards.bulkDelete(ids.slice(i, i + CHUNK))
    }

    // Một lượt quét revlog thay vì nhiều lần anyOf theo lô.
    revlogDeleted = await db.revlog.filter((r) => doomedCardIds.has(r.cardId)).delete()

    // Một lượt quét những thẻ CÒN LẠI để biết note nào vẫn được dùng.
    const stillUsed = new Set<number>()
    await db.cards.each((card) => {
      if (touchedNotes.has(card.noteId)) stillUsed.add(card.noteId)
    })

    const orphans = [...touchedNotes].filter((id) => !stillUsed.has(id))
    notesDeleted = orphans.length
    for (let i = 0; i < orphans.length; i += CHUNK) {
      await db.notes.bulkDelete(orphans.slice(i, i + CHUNK))
    }

    await db.decks.bulkDelete([...targetIds])
  })

  return {
    decks: targets.map((d) => d.name),
    cards: doomedCardIds.size,
    notes: notesDeleted,
    revlog: revlogDeleted,
  }
}
