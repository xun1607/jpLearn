import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../../db'
import { deleteDeck } from '../../db/deleteDeck'
import { deckCounts } from '../review/queue'

export interface DeckSummary {
  id: number
  name: string
  due: number
  new: number
}

export function DeckList({
  onOpen,
  onAdd,
  onImport,
}: {
  onOpen: (deck: DeckSummary) => void
  onAdd: () => void
  onImport: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState<DeckSummary | null>(null)
  const [busy, setBusy] = useState(false)

  const decks = useLiveQuery(async () => {
    const all = await db.decks.orderBy('name').toArray()
    return Promise.all(
      all.map(async (d) => ({ id: d.id, name: d.name, ...(await deckCounts(d.id)) })),
    )
  }, [])

  const totalCards = useLiveQuery(() => db.cards.count(), [])

  async function confirmDelete() {
    if (!pending) return
    setBusy(true)
    try {
      await deleteDeck(pending.id)
      setPending(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="pt-safe flex items-center gap-2 border-b border-slate-200 bg-white px-4 pb-3">
        <h1 className="flex-1 text-xl font-semibold">Bộ thẻ</h1>
        {editing ? (
          <button
            onClick={() => setEditing(false)}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-white"
          >
            Xong
          </button>
        ) : (
          <>
            <button
              onClick={() => setEditing(true)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            >
              Sửa
            </button>
            <button
              onClick={onImport}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            >
              Nhập
            </button>
            <button
              onClick={onAdd}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-white"
            >
              + Thẻ
            </button>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {decks === undefined ? (
          <div className="p-6 text-center text-slate-400">Đang nạp…</div>
        ) : decks.length === 0 ? (
          <div className="p-6 text-center text-slate-400">Chưa có deck nào</div>
        ) : (
          <ul className="divide-y divide-slate-200">
            {decks.map((deck) => (
              <li key={deck.id} className="flex items-stretch bg-white">
                {editing && (
                  <button
                    onClick={() => setPending(deck)}
                    className="flex w-12 shrink-0 items-center justify-center text-rose-500 active:bg-rose-50"
                    aria-label={`Xoá ${deck.name}`}
                  >
                    ⊖
                  </button>
                )}
                <button
                  onClick={() => (editing ? setPending(deck) : onOpen(deck))}
                  className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left active:bg-slate-100"
                >
                  <span className="min-w-0 flex-1 truncate">{deck.name}</span>
                  <span className="shrink-0 text-sm tabular-nums">
                    <span className="text-sky-600">{deck.new}</span>
                    <span className="mx-1 text-slate-300">·</span>
                    <span className="text-emerald-600">{deck.due}</span>
                  </span>
                  <span className="text-slate-300">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="px-4 py-3 text-xs leading-relaxed text-slate-400">
          <span className="text-sky-600">xanh dương</span> = thẻ mới ·{' '}
          <span className="text-emerald-600">xanh lá</span> = tới hạn ôn
          {totalCards !== undefined && <> · tổng {totalCards.toLocaleString('vi-VN')} thẻ</>}
          <br />
          Mỗi từ chỉ hỏi một lần mỗi ngày — thẻ anh em của cùng một từ được hoãn
          sang hôm sau.
        </p>
      </div>

      {pending && (
        <ConfirmDelete
          deck={pending}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  )
}

function ConfirmDelete({
  deck,
  busy,
  onCancel,
  onConfirm,
}: {
  deck: DeckSummary
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const cardCount = useLiveQuery(
    () => db.cards.where('deckId').equals(deck.id).count(),
    [deck.id],
  )
  const subdecks = useLiveQuery(
    () => db.decks.filter((d) => d.name.startsWith(`${deck.name}::`)).count(),
    [deck.name],
  )

  return (
    <div className="fixed inset-0 z-10 flex items-end bg-black/40" onClick={onCancel}>
      <div
        className="pb-safe w-full rounded-t-2xl bg-white px-5 pt-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 text-lg font-medium">Xoá bộ thẻ?</div>
        <div className="mb-4 text-sm leading-relaxed text-slate-600">
          <span className="font-medium">{deck.name}</span>
          {cardCount !== undefined && <> — {cardCount.toLocaleString('vi-VN')} thẻ</>}
          {subdecks !== undefined && subdecks > 0 && <> và {subdecks} deck con</>}. Toàn bộ
          thẻ, note và lịch sử ôn của nó sẽ mất, không hoàn lại được.
        </div>
        <div className="flex gap-2 pb-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-xl border border-slate-300 py-3 text-base"
          >
            Huỷ
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-xl bg-rose-500 py-3 text-base font-medium text-white disabled:bg-slate-300"
          >
            {busy ? 'Đang xoá…' : 'Xoá'}
          </button>
        </div>
      </div>
    </div>
  )
}
