import DOMPurify from 'dompurify'

/**
 * §7: HTML trong bộ thẻ tải về là code của người lạ — luôn chạy qua DOMPurify.
 * Tách riêng khỏi component để test bằng Node được.
 */
const CONFIG = {
  ADD_TAGS: ['ruby', 'rt', 'rb', 'rp', 'audio', 'video', 'source'],
  ADD_ATTR: [
    'controls',
    'preload',
    'autocapitalize',
    'autocorrect',
    'spellcheck',
    'data-hint',
    'data-type-field',
  ],
  // Giữ target="_blank" của các link tra cứu, nhưng không cho javascript:
  ALLOW_DATA_ATTR: true,
}

export function sanitizeCardHtml(html: string): string {
  return DOMPurify.sanitize(html, CONFIG)
}
