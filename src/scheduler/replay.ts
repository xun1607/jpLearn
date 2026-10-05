import type { CardRow } from '../db/schema'
import { applyRating, createEmptyCard, type Grade } from './index'

/** Phần của revlog đủ để phát lại: chấm gì, lúc nào. */
export interface ReviewEvent {
  rating: number
  reviewedAt: Date
  uid?: string
}

/**
 * Dựng lại trạng thái FSRS của thẻ bằng cách phát lại toàn bộ lịch sử ôn.
 *
 * Đây là nền của đồng bộ: server chỉ giữ revlog, mỗi máy tự tính lại thẻ.
 * Làm được vì ts-fsrs tất định — kể cả phần fuzz, seed lấy từ
 * `review_time + reps + D×S` chứ không lấy Math.random.
 *
 * Phần không thuộc lịch học (deck, ord, suspended) giữ nguyên từ `base`.
 * Pure function: chạy bằng Node được.
 */
export function replayCard(base: CardRow, logs: readonly ReviewEvent[]): CardRow {
  const ordered = logs
    .filter((log) => log.rating >= 1 && log.rating <= 4)
    .slice()
    // Hai máy ôn cùng một thẻ lúc offline: xếp theo thời điểm, hoà thì theo uid,
    // để máy nào phát lại cũng ra cùng một thứ tự.
    .sort(
      (a, b) =>
        a.reviewedAt.getTime() - b.reviewedAt.getTime() ||
        (a.uid ?? '').localeCompare(b.uid ?? ''),
    )

  let card: CardRow = { ...base, ...createEmptyCard(base.due) }
  for (const log of ordered) {
    const { card: next } = applyRating(card, log.rating as Grade, log.reviewedAt)
    card = { ...card, ...next }
  }
  return card
}
