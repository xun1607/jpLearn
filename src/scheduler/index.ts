import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from 'ts-fsrs'

/**
 * Lớp bọc ts-fsrs (CLAUDE.md §5). Pure function, không đụng DOM —
 * chạy được bằng Node để test.
 */

export const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: true })

export const GRADES: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]

export const GRADE_LABEL: Record<Grade, string> = {
  [Rating.Again]: 'Lại',
  [Rating.Hard]: 'Khó',
  [Rating.Good]: 'Được',
  [Rating.Easy]: 'Dễ',
}

export { createEmptyCard, Rating, State }
export type { Card, Grade }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MONTH = 30 * DAY
const YEAR = 365 * DAY

/** "1 phút" / "6 ngày" / "2,4 tháng" — nhãn dưới mỗi nút (§8). */
export function formatInterval(ms: number): string {
  if (ms < MINUTE) return '<1 phút'
  if (ms < HOUR) return `${Math.round(ms / MINUTE)} phút`
  if (ms < DAY) return `${Math.round(ms / HOUR)} giờ`
  if (ms < MONTH) return `${Math.round(ms / DAY)} ngày`
  if (ms < YEAR) return `${round1(ms / MONTH)} tháng`
  return `${round1(ms / YEAR)} năm`
}

function round1(n: number): string {
  return n.toFixed(1).replace('.0', '').replace('.', ',')
}

/**
 * Xem trước cả 4 lựa chọn bằng `repeat()` để hiện khoảng thời gian dưới mỗi nút.
 * Biến việc chọn nút từ cảm tính thành có thông tin.
 */
export function previewIntervals(card: Card, now: Date = new Date()): Record<Grade, string> {
  const preview = scheduler.repeat(card, now)
  const out = {} as Record<Grade, string>
  for (const grade of GRADES) {
    out[grade] = formatInterval(preview[grade].card.due.getTime() - now.getTime())
  }
  return out
}

/** Áp dụng một lựa chọn bằng `next()`. */
export function applyRating(card: Card, grade: Grade, now: Date = new Date()) {
  return scheduler.next(card, now, grade)
}
