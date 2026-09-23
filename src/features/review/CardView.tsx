import { useEffect, useRef } from 'react'
import { sanitizeCardHtml } from './sanitize'

/**
 * §7: render vào Shadow DOM chứ không phải iframe — CSS của notetype tự bị
 * giới hạn trong shadow root nên không rò ra làm vỡ app, mà không dính vấn đề
 * đo chiều cao iframe.
 */

/** Đặt TRƯỚC css của notetype để notetype vẫn ghi đè được. */
const BASE_CSS = `
:host { display: block; }
.card {
  font-size: 20px;
  line-height: 1.5;
  word-break: break-word;
  background: transparent;
}
img, video { max-width: 100%; height: auto; }
audio { width: 100%; max-width: 20rem; margin: 0.4rem 0; display: block; }
table { max-width: 100%; }
ruby rt { font-size: 0.5em; }
a { color: #2563eb; }
hr { border: none; border-top: 1px solid #cbd5e1; margin: 0.9rem 0; }
.cloze { color: #2563eb; font-weight: 600; }
.hint-link { cursor: pointer; text-decoration: underline dotted; }
.typeans {
  font: inherit; font-size: 1rem; width: 100%; max-width: 20rem;
  padding: 0.5rem 0.65rem; border: 1px solid #94a3b8; border-radius: 0.5rem;
}
.typeans-result code {
  font-size: 1.05em; padding: 0.1em 0.35em; border-radius: 0.3rem;
  background: #f1f5f9;
}
.typeans-ok code { background: #dcfce7; }
.typeans-bad .typeans-typed { background: #fee2e2; text-decoration: line-through; }
`

export function CardView({
  html,
  css,
  onTyped,
}: {
  html: string
  css: string
  onTyped?: (value: string) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  // Giữ callback trong ref để đổi nó không phải dựng lại cả shadow root.
  const onTypedRef = useRef(onTyped)
  onTypedRef.current = onTyped

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    root.replaceChildren()

    const style = document.createElement('style')
    style.textContent = `${BASE_CSS}\n${css}`
    root.appendChild(style)

    const card = document.createElement('div')
    card.className = 'card'
    card.innerHTML = sanitizeCardHtml(html)
    root.appendChild(card)

    function onClick(event: Event) {
      const target = event.target as HTMLElement | null
      if (!target) return

      const hintLink = target.closest?.('.hint-link') as HTMLElement | null
      if (hintLink) {
        event.preventDefault()
        event.stopPropagation()
        const box = root.getElementById?.(hintLink.dataset.hint ?? '')
        if (box instanceof HTMLElement) box.style.display = box.style.display === 'none' ? '' : 'none'
        return
      }

      // Bấm vào ô gõ / nút audio / link thì đừng lật thẻ. Listener nằm trong
      // shadow root nên thấy target thật, chặn ở đây là ngoài kia không nhận.
      if (target.closest?.('input, textarea, audio, video, button, a')) {
        event.stopPropagation()
      }
    }

    function onInput(event: Event) {
      const target = event.target as HTMLElement | null
      if (target instanceof HTMLInputElement && target.classList.contains('typeans')) {
        onTypedRef.current?.(target.value)
      }
    }

    root.addEventListener('click', onClick)
    root.addEventListener('input', onInput)

    const typeBox = card.querySelector('input.typeans')
    if (typeBox instanceof HTMLInputElement) typeBox.focus()

    return () => {
      root.removeEventListener('click', onClick)
      root.removeEventListener('input', onInput)
    }
  }, [html, css])

  return <div ref={hostRef} />
}

/**
 * Con trỏ đang ở trong ô nhập chưa? Phải lần qua shadow root vì
 * document.activeElement chỉ trả về host.
 */
export function isTypingTarget(): boolean {
  let element: Element | null = document.activeElement
  while (element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return true
    const inner: Element | null = (element as HTMLElement).shadowRoot?.activeElement ?? null
    if (inner === element) return false
    element = inner
  }
  return false
}
