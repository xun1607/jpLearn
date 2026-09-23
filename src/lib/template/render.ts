/**
 * Template engine Anki tối thiểu (CLAUDE.md §7).
 * Pure function, không đụng DOM — test bằng Node được.
 *
 * Hỗ trợ: {{Field}} · {{FrontSide}} · {{#Field}}…{{/Field}} · {{^Field}}…{{/Field}}
 *         {{cloze:…}} · {{hint:…}} · {{type:…}} · {{furigana:…}}
 * Cộng thêm các bộ lọc hay gặp trong bộ thẻ tải về: text, kana, kanji.
 */

export type Side = 'front' | 'back'

export interface TemplateData {
  /** tên field -> nội dung HTML */
  fields: Record<string, string>
  tags: string[]
  deckName: string
  notetypeName: string
  /** tên template, cho {{Card}} */
  cardName: string
  /** index template — cũng là số thứ tự cloze (ord 0 -> c1) */
  ord: number
  side: Side
  /** mặt trước đã render, cho {{FrontSide}} */
  frontSide?: string
  /** đáp án người dùng đã gõ, cho {{type:…}} ở mặt sau */
  typedAnswer?: string
}

type Node =
  | { kind: 'text'; text: string }
  | { kind: 'field'; expr: string }
  | { kind: 'section'; negate: boolean; name: string; children: Node[] }

const TAG = /\{\{([^{}]*)\}\}/g

function parse(src: string): Node[] {
  const root: Node[] = []
  const stack: { name: string; negate: boolean; children: Node[] }[] = []
  const current = () => (stack.length ? stack[stack.length - 1].children : root)

  let last = 0
  let match: RegExpExecArray | null
  TAG.lastIndex = 0

  while ((match = TAG.exec(src)) !== null) {
    if (match.index > last) current().push({ kind: 'text', text: src.slice(last, match.index) })
    last = TAG.lastIndex

    const inner = match[1].trim()
    if (inner.startsWith('#') || inner.startsWith('^')) {
      stack.push({ name: inner.slice(1).trim(), negate: inner[0] === '^', children: [] })
    } else if (inner.startsWith('/')) {
      const section = stack.pop()
      // pop trước rồi mới push: current() lúc này đã là cấp cha.
      if (section) {
        current().push({
          kind: 'section',
          negate: section.negate,
          name: section.name,
          children: section.children,
        })
      }
    } else if (inner !== '') {
      current().push({ kind: 'field', expr: inner })
    }
  }
  if (last < src.length) current().push({ kind: 'text', text: src.slice(last) })

  // Section quên đóng: gả về cấp cha thay vì vứt nội dung đi.
  while (stack.length) {
    const section = stack.pop()!
    current().push({
      kind: 'section',
      negate: section.negate,
      name: section.name,
      children: section.children,
    })
  }
  return root
}

export function renderTemplate(src: string, data: TemplateData): string {
  return renderNodes(parse(src), data)
}

function renderNodes(nodes: Node[], data: TemplateData): string {
  let out = ''
  for (const node of nodes) {
    if (node.kind === 'text') {
      out += node.text
    } else if (node.kind === 'field') {
      out += evaluate(node.expr, data)
    } else {
      const filled = !isBlank(rawField(node.name, data))
      if (filled !== node.negate) out += renderNodes(node.children, data)
    }
  }
  return out
}

/** Bộ lọc áp từ phải sang trái: {{text:furigana:Kanji}} = text(furigana(Kanji)). */
function evaluate(expr: string, data: TemplateData): string {
  const parts = expr.split(':')
  const name = parts.pop()!.trim()
  const filters = parts.map((f) => f.trim()).filter(Boolean)

  let value = rawField(name, data)
  for (let i = filters.length - 1; i >= 0; i--) {
    value = applyFilter(filters[i], value, name, data)
  }
  return value
}

function rawField(name: string, data: TemplateData): string {
  switch (name) {
    case 'FrontSide':
      return data.frontSide ?? ''
    case 'Tags':
      return data.tags.join(' ')
    case 'Type':
      return data.notetypeName
    case 'Deck':
      return data.deckName
    case 'Subdeck':
      return data.deckName.split('::').pop() ?? data.deckName
    case 'Card':
      return data.cardName
    default:
      return data.fields[name] ?? ''
  }
}

function applyFilter(filter: string, value: string, name: string, data: TemplateData): string {
  if (filter === 'text') return stripHtml(value)
  if (filter === 'furigana') return furigana(value)
  if (filter === 'kana') return kanaOnly(value)
  if (filter === 'kanji') return kanjiOnly(value)
  if (filter === 'hint') return hint(value, name)
  if (filter === 'cloze') return cloze(value, data)
  if (filter === 'type') return typeAnswer(value, name, data)
  // tts/voice và các bộ lọc lạ: bỏ qua, không làm vỡ thẻ.
  if (filter.startsWith('tts') || filter === 'voice') return ''
  return value
}

// ---------------------------------------------------------------- bộ lọc

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

export function isBlank(html: string): boolean {
  return stripHtml(html).replace(/\[sound:[^\]]*\]/g, '').trim() === ''
}

/** 漢字[かんじ] -> <ruby>漢字<rt>かんじ</rt></ruby> */
export function furigana(value: string): string {
  return value.replace(/ ?([^ >\][]+)\[(.+?)\]/g, '<ruby>$1<rt>$2</rt></ruby>')
}

/** Chỉ lấy phần đọc trong ngoặc vuông. */
function kanaOnly(value: string): string {
  return value.replace(/ ?([^ >\][]+)\[(.+?)\]/g, '$2')
}

/** Chỉ lấy phần gốc, bỏ cách đọc. */
function kanjiOnly(value: string): string {
  return value.replace(/ ?([^ >\][]+)\[(.+?)\]/g, '$1')
}

function hint(value: string, name: string): string {
  if (isBlank(value)) return ''
  const id = `hint-${name.replace(/[^A-Za-z0-9_-]/g, '')}-${Math.random().toString(36).slice(2, 8)}`
  return (
    `<a class="hint-link" data-hint="${id}" href="#">${escapeHtml(name)}</a>` +
    `<div class="hint" id="${id}" style="display:none">${value}</div>`
  )
}

/**
 * {{c1::đáp án::gợi ý}} — cloze đang xét là ord + 1.
 * Mặt trước che cloze đang xét, các cloze khác hiện bình thường.
 */
export function cloze(value: string, data: TemplateData): string {
  const active = data.ord + 1
  return value.replace(
    /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g,
    (_all, indexRaw: string, text: string, clue?: string) => {
      const index = Number(indexRaw)
      if (index !== active) return text
      if (data.side === 'front') {
        return `<span class="cloze">[${clue ? escapeHtml(clue) : '...'}]</span>`
      }
      return `<span class="cloze">${text}</span>`
    },
  )
}

function typeAnswer(value: string, name: string, data: TemplateData): string {
  if (data.side === 'front') {
    return `<input class="typeans" data-type-field="${escapeHtml(name)}" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" />`
  }
  const expected = stripHtml(value)
  const typed = (data.typedAnswer ?? '').trim()
  if (typed === '') {
    return `<div class="typeans-result"><code class="typeans-expected">${escapeHtml(expected)}</code></div>`
  }
  const ok = typed === expected
  return (
    `<div class="typeans-result ${ok ? 'typeans-ok' : 'typeans-bad'}">` +
    `<code class="typeans-typed">${escapeHtml(typed)}</code>` +
    (ok ? ' ✓' : ` ✗ <code class="typeans-expected">${escapeHtml(expected)}</code>`) +
    `</div>`
  )
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  )
}
