import type { CardRow, Note, NoteType } from '../../db/schema'
import { isBlank, renderTemplate, type TemplateData } from '../../lib/template/render'

export interface RenderedCard {
  front: string
  back: string
  css: string
  /** false = notetype không có template (gói schema v18) nên đang hiện dạng thô */
  templated: boolean
  /** template có ô {{type:…}} hay không */
  hasTypeAnswer: boolean
}

/**
 * Ghép note + notetype + card thành hai mặt thẻ.
 *
 * `card.ord` chọn template — đây là chỗ mà một note sinh ra nhiều thẻ khác nhau
 * (vd "Recognition" hỏi kanji, "Recall" hỏi nghĩa). Bỏ qua `ord` là cả hai thẻ
 * trông y hệt nhau.
 */
export function renderCard(
  note: Note,
  notetype: NoteType | undefined,
  card: Pick<CardRow, 'ord'>,
  deckName: string,
  typedAnswer?: string,
): RenderedCard {
  const template = notetype?.templates[card.ord] ?? notetype?.templates[0]

  if (!notetype || !template || template.qfmt.trim() === '') {
    return { ...rawFallback(note, notetype), templated: false, hasTypeAnswer: false }
  }

  const fields: Record<string, string> = {}
  notetype.fields.forEach((name, i) => {
    fields[name] = note.fields[i] ?? ''
  })

  const base: Omit<TemplateData, 'side'> = {
    fields,
    tags: note.tags,
    deckName,
    notetypeName: notetype.name,
    cardName: template.name,
    ord: card.ord,
    typedAnswer,
  }

  const front = renderTemplate(template.qfmt, { ...base, side: 'front' })
  const back = renderTemplate(template.afmt, { ...base, side: 'back', frontSide: front })

  // Template nào ra mặt trước rỗng thì thẻ vô dụng — thà hiện thô còn hơn hiện trắng.
  if (isBlank(front)) {
    return { ...rawFallback(note, notetype), templated: false, hasTypeAnswer: false }
  }

  return {
    front: rewriteMedia(front),
    back: rewriteMedia(back),
    css: notetype.css,
    templated: true,
    hasTypeAnswer: /\{\{[^}]*\btype\b[^}]*\}\}/.test(template.qfmt),
  }
}

/** Dạng thô: field đầu là mặt trước, các field còn lại kèm nhãn là mặt sau. */
function rawFallback(
  note: Note,
  notetype: NoteType | undefined,
): { front: string; back: string; css: string } {
  const parts: string[] = []
  for (let i = 1; i < note.fields.length; i++) {
    const value = note.fields[i] ?? ''
    if (isBlank(value)) continue
    const label = notetype?.fields[i] ?? `Field ${i + 1}`
    parts.push(
      `<div class="raw-field"><div class="raw-label">${escapeHtml(label)}</div>` +
        `<div>${value}</div></div>`,
    )
  }
  return {
    front: rewriteMedia(note.fields[0] ?? ''),
    back: rewriteMedia(parts.join('')),
    css: RAW_CSS,
  }
}

const RAW_CSS = `
.card { text-align: left; }
.raw-field { margin-bottom: 0.9rem; }
.raw-label {
  font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
  color: #94a3b8; margin-bottom: 2px;
}
`

/**
 * §7: thẻ gốc viết `<img src="neko.jpg">`, chỉ cần đổi đường dẫn thành
 * `/media/neko.jpg` là service worker phục vụ được từ IndexedDB — khỏi phải
 * quản lý vòng đời URL.createObjectURL.
 */
export function rewriteMedia(html: string): string {
  const withSrc = html.replace(
    /(<(?:img|audio|video|source)\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi,
    (all, prefix: string, quote: string, url: string) => {
      if (/^(?:[a-z]+:|\/\/|\/)/i.test(url)) return all
      return `${prefix}${quote}/media/${encodeURIComponent(url)}${quote}`
    },
  )
  return withSrc.replace(
    /\[sound:([^\]]+)\]/g,
    (_all, name: string) =>
      `<audio class="anki-sound" controls preload="none" src="/media/${encodeURIComponent(name)}"></audio>`,
  )
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  )
}
