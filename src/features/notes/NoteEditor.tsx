import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { addNote, BASIC_NOTETYPE_ID, db, DEFAULT_DECK_ID } from '../../db'

export function NoteEditor({ onExit }: { onExit: () => void }) {
  const decks = useLiveQuery(() => db.decks.orderBy('name').toArray(), [])
  const notetype = useLiveQuery(() => db.notetypes.get(BASIC_NOTETYPE_ID), [])

  const [deckId, setDeckId] = useState(DEFAULT_DECK_ID)
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [saved, setSaved] = useState(0)
  const frontRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    frontRef.current?.focus()
  }, [])

  async function save() {
    if (!front.trim()) return
    await addNote(deckId, BASIC_NOTETYPE_ID, [front.trim(), back.trim()])
    setFront('')
    setBack('')
    setSaved((n) => n + 1)
    frontRef.current?.focus()
  }

  const labels = notetype?.fields ?? ['Mặt trước', 'Mặt sau']

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="pt-safe flex items-center gap-3 border-b border-slate-200 bg-white px-3 pb-2">
        <button onClick={onExit} className="-ml-1 px-2 py-1 text-slate-500">
          ←
        </button>
        <div className="flex-1 text-sm font-medium">Thẻ mới</div>
        {saved > 0 && <div className="text-xs text-emerald-600">đã lưu {saved}</div>}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">Deck</span>
            <select
              value={deckId}
              onChange={(e) => setDeckId(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base"
            >
              {(decks ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">{labels[0]}</span>
            <textarea
              ref={frontRef}
              value={front}
              onChange={(e) => setFront(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">{labels[1]}</span>
            <textarea
              value={back}
              onChange={(e) => setBack(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base"
            />
          </label>
        </div>
      </div>

      <div className="pb-safe border-t border-slate-200 bg-white px-4 pt-2">
        <button
          onClick={save}
          disabled={!front.trim()}
          className="mx-auto block w-full max-w-2xl rounded-xl bg-emerald-500 py-3.5 text-base font-medium text-white disabled:bg-slate-300"
        >
          Lưu và thêm tiếp
        </button>
      </div>
    </div>
  )
}
