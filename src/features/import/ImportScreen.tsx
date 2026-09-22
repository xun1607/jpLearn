import { useRef, useState } from 'react'
import { importCollection, type ImportSummary } from '../../db/importCollection'
import type { ImportRequest, ImportResponse } from '../../workers/importApkg.worker'

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; phase: string; done?: number; total?: number }
  | { kind: 'done'; summary: ImportSummary }
  | { kind: 'error'; message: string }

export function ImportScreen({ onExit }: { onExit: () => void }) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setStatus({ kind: 'busy', phase: 'Đọc file' })

    const worker = new Worker(new URL('../../workers/importApkg.worker.ts', import.meta.url), {
      type: 'module',
    })

    worker.onmessage = async (event: MessageEvent<ImportResponse>) => {
      const msg = event.data
      if (msg.type === 'progress') {
        setStatus({ kind: 'busy', phase: msg.phase, done: msg.done, total: msg.total })
        return
      }
      if (msg.type === 'error') {
        setStatus({ kind: 'error', message: msg.message })
        worker.terminate()
        return
      }
      try {
        const summary = await importCollection(msg.collection, (phase, done, total) =>
          setStatus({ kind: 'busy', phase, done, total }),
        )
        setStatus({ kind: 'done', summary })
      } catch (err) {
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        worker.terminate()
      }
    }

    worker.onerror = (err) => {
      setStatus({ kind: 'error', message: err.message || 'Worker lỗi' })
      worker.terminate()
    }

    const buffer = await file.arrayBuffer()
    const req: ImportRequest = { file: buffer }
    worker.postMessage(req, [buffer])
  }

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="pt-safe flex items-center gap-3 border-b border-slate-200 bg-white px-3 pb-2">
        <button onClick={onExit} className="-ml-1 px-2 py-1 text-slate-500">
          ←
        </button>
        <div className="flex-1 text-sm font-medium">Nhập bộ thẻ .apkg</div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl space-y-4">
          <input
            ref={inputRef}
            type="file"
            accept=".apkg,application/octet-stream"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
              e.target.value = ''
            }}
          />

          {status.kind === 'idle' && (
            <>
              <button
                onClick={() => inputRef.current?.click()}
                className="w-full rounded-xl border-2 border-dashed border-slate-300 bg-white py-10 text-slate-600"
              >
                Chọn file .apkg
              </button>
              <p className="text-xs leading-relaxed text-slate-500">
                Thẻ nhập vào đều ở trạng thái <b>mới</b> — lịch học cũ trong gói không
                chuyển sang FSRS được nên bỏ qua. Bản này hiển thị thẻ dạng thô (field 1 /
                các field còn lại); template và CSS của bộ thẻ sẽ có ở bản sau.
              </p>
            </>
          )}

          {status.kind === 'busy' && (
            <div className="rounded-xl bg-white p-6 text-center">
              <div className="mb-3 text-sm text-slate-600">{status.phase}…</div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-sky-500 transition-[width]"
                  style={{
                    width:
                      status.total && status.done !== undefined
                        ? `${Math.round((status.done / status.total) * 100)}%`
                        : '35%',
                  }}
                />
              </div>
              {status.total !== undefined && status.done !== undefined && (
                <div className="mt-2 text-xs text-slate-400 tabular-nums">
                  {status.done} / {status.total}
                </div>
              )}
            </div>
          )}

          {status.kind === 'error' && (
            <div className="space-y-3">
              <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">
                {status.message}
              </div>
              <button
                onClick={() => setStatus({ kind: 'idle' })}
                className="w-full rounded-xl bg-slate-800 py-3 text-white"
              >
                Thử file khác
              </button>
            </div>
          )}

          {status.kind === 'done' && (
            <div className="space-y-4">
              <div className="rounded-xl bg-white p-4">
                <div className="mb-3 text-base font-medium text-emerald-600">Nhập xong</div>
                <dl className="space-y-1.5 text-sm">
                  <Row label="Schema" value={status.summary.schema} />
                  <Row label="Note" value={String(status.summary.notes)} />
                  <Row label="Thẻ mới thêm" value={String(status.summary.newCards)} />
                  {status.summary.keptCards > 0 && (
                    <Row label="Thẻ đã có, giữ nguyên" value={String(status.summary.keptCards)} />
                  )}
                  <Row label="Media" value={String(status.summary.media)} />
                </dl>
                <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
                  <div className="mb-1 text-xs text-slate-400">Deck</div>
                  <ul className="space-y-0.5">
                    {status.summary.decks.map((name) => (
                      <li key={name} className="truncate">
                        {name}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {status.summary.warnings.length > 0 && (
                <ul className="space-y-2">
                  {status.summary.warnings.map((w, i) => (
                    <li key={i} className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                      {w}
                    </li>
                  ))}
                </ul>
              )}

              <button
                onClick={onExit}
                className="w-full rounded-xl bg-emerald-500 py-3.5 text-base font-medium text-white"
              >
                Về danh sách deck
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate tabular-nums">{value}</dd>
    </div>
  )
}
