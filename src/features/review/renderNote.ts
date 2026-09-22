import DOMPurify from 'dompurify'
import type { Note, NoteType } from '../../db/schema'

/**
 * Render thô cho MVP: mặt trước = field đầu, mặt sau = các field còn lại.
 * Template engine ({{Field}}, Shadow DOM, CSS notetype) là bước 3 của lộ trình.
 *
 * HTML trong bộ thẻ tải về là code của người lạ — LUÔN qua DOMPurify (§7).
 */

function clean(html: string): string {
  return DOMPurify.sanitize(html, { ADD_ATTR: ['controls'] })
}

function isEmpty(html: string): boolean {
  return clean(html).replace(/<[^>]*>/g, '').trim() === ''
}

export function renderFront(note: Note): string {
  return clean(note.fields[0] ?? '')
}

/** Các field còn lại, mỗi field kèm nhãn tên field cho deck nhiều field. */
export function renderBack(note: Note, notetype: NoteType | undefined): string {
  const parts: string[] = []
  for (let i = 1; i < note.fields.length; i++) {
    const value = note.fields[i] ?? ''
    if (isEmpty(value)) continue
    const label = notetype?.fields[i] ?? `Field ${i + 1}`
    parts.push(
      `<div class="mb-3"><div class="text-[11px] uppercase tracking-wide text-slate-400 mb-1">${escapeHtml(
        label,
      )}</div><div>${clean(value)}</div></div>`,
    )
  }
  return parts.join('')
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}
