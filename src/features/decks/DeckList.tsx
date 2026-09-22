import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
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
  const decks = useLiveQuery(async () => {
    const all = await db.decks.orderBy('name').toArray()
    return Promise.all(
      all.map(async (d) => ({ id: d.id, name: d.name, ...(await deckCounts(d.id)) })),
    )
  }, [])

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="pt-safe flex items-center gap-2 border-b border-slate-200 bg-white px-4 pb-3">
        <h1 className="flex-1 text-xl font-semibold">Bộ thẻ</h1>
        <button
          onClick={onImport}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        >
          Nhập .apkg
        </button>
        <button onClick={onAdd} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-white">
          + Thẻ
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {decks === undefined ? (
          <div className="p-6 text-center text-slate-400">Đang nạp…</div>
        ) : decks.length === 0 ? (
          <div className="p-6 text-center text-slate-400">Chưa có deck nào</div>
        ) : (
          <ul className="divide-y divide-slate-200">
            {decks.map((deck) => {
              const total = deck.due + deck.new
              return (
                <li key={deck.id}>
                  <button
                    onClick={() => onOpen(deck)}
                    className="flex w-full items-center gap-3 bg-white px-4 py-3.5 text-left active:bg-slate-100"
                  >
                    <span className="min-w-0 flex-1 truncate">{deck.name}</span>
                    <span className="shrink-0 text-sm tabular-nums">
                      <span className="text-sky-600">{deck.new}</span>
                      <span className="mx-1 text-slate-300">·</span>
                      <span className="text-emerald-600">{deck.due}</span>
                    </span>
                    <span className={total > 0 ? 'text-slate-300' : 'text-slate-200'}>›</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <p className="px-4 py-3 text-xs text-slate-400">
          <span className="text-sky-600">xanh dương</span> = thẻ mới ·{' '}
          <span className="text-emerald-600">xanh lá</span> = tới hạn ôn
        </p>
      </div>
    </div>
  )
}
