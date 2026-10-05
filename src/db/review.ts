import { applyRating, type Grade } from '../scheduler'
import { replayCard } from '../scheduler/replay'
import { db as defaultDb, newUid, type FlashcardDB } from './index'
import type { CardRow } from './schema'

/**
 * Ghi một lần chấm điểm: cập nhật thẻ + thêm một dòng revlog chờ đồng bộ.
 *
 * Đọc lại thẻ từ DB chứ không tin bản nằm trong hàng đợi: đồng bộ có thể đã
 * dựng lại thẻ này từ revlog của máy khác trong lúc phiên ôn đang mở.
 */
export async function recordReview(
  cardId: number,
  grade: Grade,
  now: Date = new Date(),
  db: FlashcardDB = defaultDb,
): Promise<CardRow> {
  return db.transaction('rw', db.cards, db.revlog, async () => {
    const card = await db.cards.get(cardId)
    if (!card) throw new Error('Thẻ không còn tồn tại')

    const { card: next, log } = applyRating(card, grade, now)
    const updated: CardRow = { ...card, ...next }
    await db.cards.put(updated)
    await db.revlog.add({
      uid: newUid(),
      synced: 0,
      cardId,
      rating: log.rating,
      state: log.state,
      elapsedDays: log.elapsed_days,
      scheduledDays: log.scheduled_days,
      reviewedAt: now,
    })
    return updated
  })
}

/** Phát lại revlog cho từng thẻ trong danh sách. Thẻ chưa có trong máy thì bỏ qua. */
export async function rebuildCards(
  cardIds: Iterable<number>,
  db: FlashcardDB = defaultDb,
): Promise<number> {
  let rebuilt = 0
  await db.transaction('rw', db.cards, db.revlog, async () => {
    for (const id of cardIds) {
      const card = await db.cards.get(id)
      if (!card) continue
      const logs = await db.revlog.where('cardId').equals(id).toArray()
      await db.cards.put(replayCard(card, logs))
      rebuilt++
    }
  })
  return rebuilt
}

/**
 * Sau khi thêm thẻ mới (nhập .apkg): thẻ nào đã có sẵn revlog thì dựng lại.
 *
 * Revlog kéo từ máy khác có thể tới TRƯỚC khi máy này nhập bộ thẻ — lúc đó nó
 * nằm chờ trong bảng revlog, tới giờ mới có thẻ để áp vào.
 * Quét revlog một lượt thay vì hỏi index cho từng thẻ: bộ 7k thẻ mà gọi
 * `where().equals()` 7k lần thì chậm hơn nhiều so với một lượt quét.
 */
export async function rebuildReviewedAmong(
  cardIds: readonly number[],
  db: FlashcardDB = defaultDb,
): Promise<number> {
  if (cardIds.length === 0) return 0
  const wanted = new Set(cardIds)
  const hit = new Set<number>()
  await db.revlog.each((log) => {
    if (wanted.has(log.cardId)) hit.add(log.cardId)
  })
  return rebuildCards(hit, db)
}
