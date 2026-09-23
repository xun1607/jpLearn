import { db } from './index'
import type { Note } from './schema'

const CHUNK = 500

/** Sửa nội dung field và tag của một note. Mọi thẻ sinh từ nó đổi theo. */
export async function updateNote(
  noteId: number,
  fields: string[],
  tags: string[],
): Promise<void> {
  const note = await db.notes.get(noteId)
  if (!note) throw new Error('Note không còn tồn tại')
  const updated: Note = { ...note, fields, tags: tags.filter(Boolean) }
  await db.notes.put(updated)
}

/** Tạm dừng / bỏ tạm dừng một thẻ. Thẻ tạm dừng không vào hàng đợi ôn. */
export async function setSuspended(cardId: number, suspended: boolean): Promise<void> {
  await db.cards.update(cardId, { suspended: suspended ? 1 : 0 })
}

/** Chuyển một thẻ sang deck khác. */
export async function moveCard(cardId: number, deckId: number): Promise<void> {
  await db.cards.update(cardId, { deckId })
}

/**
 * Xoá hẳn note cùng toàn bộ thẻ và revlog của nó.
 * Khác `deleteDeck`: ở đây note là thứ bị nhắm tới, nên thẻ nằm ở deck nào
 * cũng đi theo.
 */
export async function deleteNote(noteId: number): Promise<{ cards: number; revlog: number }> {
  const cards = await db.cards.where('noteId').equals(noteId).toArray()
  const cardIds = cards.map((c) => c.id)
  let revlog = 0

  await db.transaction('rw', db.cards, db.notes, db.revlog, async () => {
    for (let i = 0; i < cardIds.length; i += CHUNK) {
      const slice = cardIds.slice(i, i + CHUNK)
      revlog += await db.revlog.where('cardId').anyOf(slice).delete()
      await db.cards.bulkDelete(slice)
    }
    await db.notes.delete(noteId)
  })

  return { cards: cardIds.length, revlog }
}
