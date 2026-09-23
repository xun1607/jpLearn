import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../../db'
import { deleteNote, moveCard, setSuspended, updateNote } from '../../db/editNotes'
import { formatInterval } from '../../scheduler'
import { CardView } from '../review/CardView'
import { renderCard } from '../review/renderCard'
import type { BrowseRow } from './runSearch'
import { STATE_LABEL } from './search'

/**
 * Sửa note, làm việc trên card đang chọn.
 *
 * Giống Anki: danh sách liệt kê CARD, còn ô sửa thì sửa NOTE. Đổi một field là
 * mọi thẻ sinh từ note đó đổi theo — đấy là lý do tách note và card ngay từ đầu.
 */
export function CardEditor({
  row,
  onClose,
}: {
  row: BrowseRow
  onClose: (changed: boolean) => void
}) {
  const [fields, setFields] = useState<string[]>(row.note.fields)
  const [tags, setTags] = useState(row.note.tags.join(' '))
  const [suspended, setSuspendedState] = useState(row.card.suspended === 1)
  const [deckId, setDeckId] = useState(row.card.deckId)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [preview, setPreview] = useState<'front' | 'back' | null>(null)

  const decks = useLiveQuery(() => db.decks.orderBy('name').toArray(), [])

  const labels = row.notetype?.fields ?? fields.map((_, i) => `Field ${i + 1}`)

  function editField(index: number, value: string) {
    setFields((prev) => prev.map((f, i) => (i === index ? value : f)))
    setDirty(true)
  }

  async function save() {
    setSaving(true)
    try {
      await updateNote(row.note.id, fields, tags.trim().split(/\s+/).filter(Boolean))
      if (suspended !== (row.card.suspended === 1)) await setSuspended(row.card.id, suspended)
      if (deckId !== row.card.deckId) await moveCard(row.card.id, deckId)
      onClose(true)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    await deleteNote(row.note.id)
    onClose(true)
  }

  const rendered = renderCard(
    { ...row.note, fields },
    row.notetype,
    row.card,
    row.deckName,
  )

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="pt-safe flex items-center gap-3 border-b border-slate-200 bg-white px-3 pb-2">
        <button onClick={() => onClose(false)} className="-ml-1 px-2 py-1 text-slate-500">
          ←
        </button>
        <div className="min-w-0 flex-1 truncate text-sm font-medium">
          {row.notetype?.name ?? 'Note'}
        </div>
        <button
          onClick={() => setPreview(preview ? null : 'front')}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs"
        >
          {preview ? 'Ẩn thử' : 'Xem thử'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl space-y-4">
          {preview && (
            <div className="rounded-xl bg-white p-4">
              <div className="mb-2 flex gap-2">
                {(['front', 'back'] as const).map((side) => (
                  <button
                    key={side}
                    onClick={() => setPreview(side)}
                    className={`rounded-lg px-2.5 py-1 text-xs ${
                      preview === side ? 'bg-slate-800 text-white' : 'border border-slate-300'
                    }`}
                  >
                    {side === 'front' ? 'Mặt trước' : 'Mặt sau'}
                  </button>
                ))}
              </div>
              <CardView
                html={preview === 'front' ? rendered.front : rendered.back}
                css={rendered.css}
              />
            </div>
          )}

          {fields.map((value, i) => (
            <label key={i} className="block">
              <span className="mb-1 block text-xs text-slate-500">{labels[i] ?? `Field ${i + 1}`}</span>
              <textarea
                value={value}
                onChange={(e) => editField(i, e.target.value)}
                rows={value.length > 90 ? 4 : 2}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm"
              />
            </label>
          ))}

          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">Tag (cách nhau bằng dấu cách)</span>
            <input
              value={tags}
              onChange={(e) => {
                setTags(e.target.value)
                setDirty(true)
              }}
              autoCapitalize="off"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">Deck của thẻ này</span>
            <select
              value={deckId}
              onChange={(e) => {
                setDeckId(Number(e.target.value))
                setDirty(true)
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base"
            >
              {(decks ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-3 rounded-lg bg-white px-3 py-3">
            <input
              type="checkbox"
              checked={suspended}
              onChange={(e) => {
                setSuspendedState(e.target.checked)
                setDirty(true)
              }}
              className="h-5 w-5"
            />
            <span className="flex-1 text-sm">
              Tạm dừng thẻ này
              <span className="block text-xs text-slate-400">Không đưa vào hàng đợi ôn</span>
            </span>
          </label>

          <CardStats row={row} />

          {confirmDelete ? (
            <div className="rounded-xl bg-rose-50 p-4">
              <div className="mb-3 text-sm text-rose-800">
                Xoá hẳn note này cùng tất cả thẻ sinh từ nó? Không hoàn lại được.
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 rounded-xl border border-slate-300 bg-white py-2.5 text-sm"
                >
                  Huỷ
                </button>
                <button
                  onClick={remove}
                  className="flex-1 rounded-xl bg-rose-500 py-2.5 text-sm font-medium text-white"
                >
                  Xoá note
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full rounded-xl border border-rose-200 py-2.5 text-sm text-rose-600"
            >
              Xoá note
            </button>
          )}
        </div>
      </div>

      <div className="pb-safe border-t border-slate-200 bg-white px-4 pt-2">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="mx-auto block w-full max-w-2xl rounded-xl bg-emerald-500 py-3.5 text-base font-medium text-white disabled:bg-slate-300"
        >
          {saving ? 'Đang lưu…' : dirty ? 'Lưu' : 'Chưa có thay đổi'}
        </button>
      </div>
    </div>
  )
}

/** Số liệu FSRS của thẻ — xem được thì mới hiểu vì sao nó hẹn ngày đó. */
function CardStats({ row }: { row: BrowseRow }) {
  const { card } = row
  const untilDue = card.due.getTime() - Date.now()
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl bg-white p-4 text-sm">
      <Stat label="Trạng thái" value={STATE_LABEL[card.state] ?? '?'} />
      <Stat
        label="Đến hạn"
        value={untilDue <= 0 ? 'ngay bây giờ' : `sau ${formatInterval(untilDue)}`}
      />
      <Stat label="Số lần ôn" value={String(card.reps)} />
      <Stat label="Số lần quên" value={String(card.lapses)} />
      <Stat label="Stability" value={card.stability ? card.stability.toFixed(2) : '—'} />
      <Stat label="Difficulty" value={card.difficulty ? card.difficulty.toFixed(2) : '—'} />
    </dl>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate tabular-nums">{value}</dd>
    </div>
  )
}
