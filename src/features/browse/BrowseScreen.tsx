import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { db } from '../../db'
import type { BrowseRow } from './runSearch'
import { runSearch, type SearchResult } from './runSearch'
import { CardEditor } from './CardEditor'
import { STATE_LABEL } from './search'

/** Gõ tới đâu tìm tới đó, nhưng đợi ngừng gõ — mỗi lần tìm là quét cả bảng. */
const DEBOUNCE_MS = 250

export function BrowseScreen({
  initialQuery = '',
  onExit,
}: {
  initialQuery?: string
  onExit: () => void
}) {
  const [input, setInput] = useState(initialQuery)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [searching, setSearching] = useState(true)
  const [open, setOpen] = useState<BrowseRow | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const decks = useLiveQuery(() => db.decks.orderBy('name').toArray(), [])

  function addToken(token: string) {
    setInput((v) => (v ? `${v.trim()} ${token}` : token))
    inputRef.current?.focus()
  }

  useEffect(() => {
    let alive = true
    setSearching(true)
    const timer = setTimeout(() => {
      runSearch(input).then((r) => {
        if (!alive) return
        setResult(r)
        setSearching(false)
      })
    }, DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [input, reloadKey])

  if (open) {
    return (
      <CardEditor
        row={open}
        onClose={(changed) => {
          setOpen(null)
          if (changed) setReloadKey((k) => k + 1)
        }}
      />
    )
  }

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="pt-safe border-b border-slate-200 bg-white px-3 pb-2">
        <div className="flex items-center gap-2">
          <button onClick={onExit} className="-ml-1 px-2 py-1 text-slate-500" aria-label="Quay lại">
            ←
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tìm thẻ…"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
          {input !== '' && (
            <button onClick={() => setInput('')} className="px-2 py-1 text-slate-400">
              ✕
            </button>
          )}
        </div>
        <div className="mt-1.5 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {['is:due', 'is:new', 'is:suspended'].map((chip) => (
            <button
              key={chip}
              onClick={() => addToken(chip)}
              className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600"
            >
              {chip}
            </button>
          ))}
          {(decks ?? []).map((deck) => (
            <button
              key={deck.id}
              onClick={() => addToken(`deck:"${deck.name}"`)}
              className="max-w-40 shrink-0 truncate rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs text-sky-700"
              title={deck.name}
            >
              {deck.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-2 text-xs text-slate-400 tabular-nums">
          {searching
            ? 'đang tìm…'
            : result
              ? `${result.total.toLocaleString('vi-VN')} thẻ khớp` +
                (result.truncated ? ` · hiện ${result.rows.length} thẻ đầu` : '')
              : ''}
        </div>

        {result && result.rows.length === 0 && !searching && (
          <div className="p-6 text-center text-sm text-slate-400">Không có thẻ nào khớp</div>
        )}

        <ul className="divide-y divide-slate-200">
          {result?.rows.map((row) => (
            <li key={row.card.id}>
              <button
                onClick={() => setOpen(row)}
                className="w-full bg-white px-4 py-3 text-left active:bg-slate-100"
              >
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-base">{row.title}</span>
                  {row.card.suspended === 1 && (
                    <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                      tạm dừng
                    </span>
                  )}
                </div>
                {row.preview && (
                  <div className="mt-0.5 truncate text-sm text-slate-500">{row.preview}</div>
                )}
                <div className="mt-1 truncate text-[11px] text-slate-400">
                  {row.deckName}
                  <span className="mx-1">·</span>
                  {row.notetype?.templates[row.card.ord]?.name ?? `thẻ ${row.card.ord + 1}`}
                  <span className="mx-1">·</span>
                  {STATE_LABEL[row.card.state] ?? '?'}
                </div>
              </button>
            </li>
          ))}
        </ul>

        <div className="px-4 py-4 text-[11px] leading-relaxed text-slate-400">
          Cú pháp: <code>deck:N5</code> · <code>tag:động-từ</code> · <code>is:due</code> ·{' '}
          <code>is:new</code> · <code>is:suspended</code> · <code>-từ-loại-trừ</code> ·{' '}
          <code>"cụm có dấu cách"</code>. Nhiều điều kiện thì phải khớp tất cả.
        </div>
      </div>
    </div>
  )
}
