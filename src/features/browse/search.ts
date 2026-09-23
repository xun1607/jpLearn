import { State } from 'ts-fsrs'
import type { CardRow, Note } from '../../db/schema'
import { stripHtml } from '../../lib/template/render'

/**
 * Cú pháp tìm kiếm kiểu Anki, phần hay dùng nhất.
 * Pure function — test bằng Node được, không đụng Dexie.
 *
 *   漢字                    chữ nào cũng phải có (AND)
 *   -がっこう                loại bỏ
 *   deck:N5                 tên deck chứa "N5"
 *   deck:"Nhật Bản::N5"     tên có dấu cách thì bọc nháy
 *   tag:động-từ             có tag này
 *   is:new is:due is:suspended is:learn is:review
 */

export type IsFilter = 'new' | 'learn' | 'review' | 'due' | 'suspended'

export interface Query {
  /** từ khoá phải có, đã hạ chữ thường */
  terms: string[]
  /** từ khoá không được có */
  negated: string[]
  decks: string[]
  tags: string[]
  is: IsFilter[]
  /** true khi câu truy vấn không lọc gì cả */
  empty: boolean
}

const IS_VALUES: IsFilter[] = ['new', 'learn', 'review', 'due', 'suspended']

/** Cắt câu thành từng token, giữ nguyên cụm trong dấu nháy. */
function tokenize(input: string): string[] {
  const out: string[] = []
  const re = /(-?)(?:(\w+):)?(?:"([^"]*)"|(\S+))/g
  let match: RegExpExecArray | null
  while ((match = re.exec(input)) !== null) {
    const [, negate, prefix, quoted, bare] = match
    const value = quoted ?? bare ?? ''
    out.push(`${negate}${prefix ? `${prefix}:` : ''}${value}`)
  }
  return out
}

export function parseQuery(input: string): Query {
  const query: Query = { terms: [], negated: [], decks: [], tags: [], is: [], empty: true }

  for (const raw of tokenize(input)) {
    const negate = raw.startsWith('-')
    const token = negate ? raw.slice(1) : raw
    if (token === '') continue

    const colon = token.indexOf(':')
    const prefix = colon > 0 ? token.slice(0, colon).toLowerCase() : ''
    const value = colon > 0 ? token.slice(colon + 1) : token
    if (value === '') continue

    if (prefix === 'deck') query.decks.push(value.toLowerCase())
    else if (prefix === 'tag') query.tags.push(value.toLowerCase())
    else if (prefix === 'is') {
      const v = value.toLowerCase() as IsFilter
      if (IS_VALUES.includes(v)) query.is.push(v)
      // "is:" lạ thì bỏ qua chứ không coi là từ khoá — gõ nhầm mà trả về cả
      // đống kết quả không liên quan thì khó hiểu hơn là trả về đúng phần lọc.
    } else if (negate) query.negated.push(value.toLowerCase())
    else query.terms.push(value.toLowerCase())
  }

  query.empty =
    query.terms.length === 0 &&
    query.negated.length === 0 &&
    query.decks.length === 0 &&
    query.tags.length === 0 &&
    query.is.length === 0
  return query
}

/** Toàn bộ nội dung note gộp thành một chuỗi thường để dò từ khoá. */
export function noteHaystack(note: Note): string {
  return `${note.fields.map(stripHtml).join(' ')} ${note.tags.join(' ')}`.toLowerCase()
}

/** Phần lọc chỉ cần tới note — chạy trước để thu hẹp trước khi đụng tới card. */
export function matchesNote(note: Note, query: Query, haystack = noteHaystack(note)): boolean {
  for (const term of query.terms) {
    if (!haystack.includes(term)) return false
  }
  for (const term of query.negated) {
    if (haystack.includes(term)) return false
  }
  for (const tag of query.tags) {
    if (!note.tags.some((t) => t.toLowerCase() === tag)) return false
  }
  return true
}

/** Phần lọc cần tới card: deck, trạng thái, tạm dừng. */
export function matchesCard(
  card: CardRow,
  deckName: string,
  query: Query,
  now: Date = new Date(),
): boolean {
  if (query.decks.length > 0) {
    const lower = deckName.toLowerCase()
    if (!query.decks.some((d) => lower.includes(d))) return false
  }

  for (const filter of query.is) {
    if (!matchesIs(card, filter, now)) return false
  }
  return true
}

function matchesIs(card: CardRow, filter: IsFilter, now: Date): boolean {
  switch (filter) {
    case 'suspended':
      return card.suspended === 1
    case 'new':
      return card.state === State.New
    case 'learn':
      return card.state === State.Learning || card.state === State.Relearning
    case 'review':
      return card.state === State.Review
    case 'due':
      // Thẻ mới không tính là "tới hạn" — nó chưa từng được hẹn.
      return card.state !== State.New && card.due.getTime() <= now.getTime()
  }
}

/** Chỉ cần quét note khi câu truy vấn có phần lọc thuộc về note. */
export function needsNoteScan(query: Query): boolean {
  return query.terms.length > 0 || query.negated.length > 0 || query.tags.length > 0
}

export const STATE_LABEL: Record<number, string> = {
  [State.New]: 'mới',
  [State.Learning]: 'đang học',
  [State.Review]: 'ôn tập',
  [State.Relearning]: 'học lại',
}
