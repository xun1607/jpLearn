import type { Card as FsrsCard } from 'ts-fsrs'

/**
 * Data model bám sát schema của Anki (CLAUDE.md §4).
 * Note và card là hai thứ khác nhau: một note sinh ra nhiều card qua nhiều
 * template, `ord` trỏ tới index template trong notetype.
 */

export interface Template {
  name: string
  qfmt: string
  afmt: string
}

export interface NoteType {
  id: number
  name: string
  fields: string[]
  css: string
  templates: Template[]
}

export interface Deck {
  id: number
  /** Phân cấp bằng "::" — "Nhật::N3::Kanji" */
  name: string
}

export interface Note {
  id: number
  notetypeId: number
  guid: string
  fields: string[]
  tags: string[]
}

/**
 * Card row = phần của ta + toàn bộ field ts-fsrs cần.
 *
 * Nhúng thẳng `FsrsCard` (due, stability, difficulty, elapsed_days,
 * scheduled_days, learning_steps, reps, lapses, state, last_review) để
 * `scheduler.next(row, ...)` nhận được row nguyên vẹn, khỏi lớp map qua lại.
 * Đây là mở rộng danh sách §4 chứ không thay đổi nó.
 */
export interface CardRow extends FsrsCard {
  id: number
  noteId: number
  deckId: number
  /** index template trong notetype */
  ord: number
  suspended: 0 | 1
}

export interface RevlogRow {
  /** Khoá cục bộ, chỉ có nghĩa trong máy này. */
  id?: number
  /**
   * Khoá toàn cục, dùng chung giữa các máy. Đồng bộ dựa vào nó để chống trùng:
   * cùng một lần ôn đẩy lên hai lần hay kéo về hai lần vẫn chỉ là một dòng.
   */
  uid: string
  /** 1 = đã nằm trên server. Index Dexie không nhận boolean nên dùng số. */
  synced: 0 | 1
  cardId: number
  rating: number
  state: number
  elapsedDays: number
  scheduledDays: number
  reviewedAt: Date
}

export interface MediaRow {
  name: string
  blob: Blob
}

export interface ConfigRow {
  key: string
  value: unknown
}
