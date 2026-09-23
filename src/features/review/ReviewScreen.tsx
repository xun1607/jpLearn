import { useCallback, useEffect, useMemo, useState } from 'react'
import { db } from '../../db'
import type { CardRow, Note, NoteType } from '../../db/schema'
import { applyRating, previewIntervals, type Grade } from '../../scheduler'
import { AnswerBar, ShowAnswerBar } from './AnswerBar'
import { CardView, isTypingTarget } from './CardView'
import { buildQueue, DEFAULT_NEW_PER_DAY } from './queue'
import { renderCard } from './renderCard'

/** Thẻ bấm "Lại" phải quay lại trong cùng phiên, không đợi sang ngày. */
const RELEARN_WINDOW_MS = 20 * 60 * 1000

export function ReviewScreen({
  deckId,
  deckName,
  newPerDay = DEFAULT_NEW_PER_DAY,
  onExit,
}: {
  deckId: number
  deckName: string
  newPerDay?: number
  onExit: () => void
}) {
  const [queue, setQueue] = useState<CardRow[] | null>(null)
  const [reviewed, setReviewed] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [typedAnswer, setTypedAnswer] = useState('')
  const [note, setNote] = useState<Note | null>(null)
  const [notetype, setNotetype] = useState<NoteType | undefined>(undefined)

  const card = queue?.[0] ?? null

  useEffect(() => {
    let alive = true
    buildQueue(deckId, newPerDay).then((q) => {
      if (alive) setQueue(q)
    })
    return () => {
      alive = false
    }
  }, [deckId, newPerDay])

  // Nạp note của thẻ hiện tại (không load cả deck vào RAM).
  useEffect(() => {
    if (!card) {
      setNote(null)
      return
    }
    let alive = true
    db.notes.get(card.noteId).then(async (n) => {
      if (!alive) return
      setNote(n ?? null)
      setNotetype(n ? await db.notetypes.get(n.notetypeId) : undefined)
    })
    return () => {
      alive = false
    }
  }, [card?.id, card?.noteId])

  const rendered = useMemo(
    () => (note && card ? renderCard(note, notetype, card, deckName, typedAnswer) : null),
    [note, notetype, card?.id, card?.ord, deckName, typedAnswer],
  )

  const intervals = useMemo(
    () => (card ? previewIntervals(card) : null),
    [card?.id, card?.reps, card?.state],
  )

  const reveal = useCallback(() => setShowAnswer(true), [])

  const rate = useCallback(
    async (grade: Grade) => {
      if (!card) return
      const now = new Date()
      const { card: next, log } = applyRating(card, grade, now)
      const updated: CardRow = { ...card, ...next }

      await db.transaction('rw', db.cards, db.revlog, async () => {
        await db.cards.put(updated)
        await db.revlog.add({
          cardId: card.id,
          rating: log.rating,
          state: log.state,
          elapsedDays: log.elapsed_days,
          scheduledDays: log.scheduled_days,
          reviewedAt: now,
        })
      })

      setReviewed((n) => n + 1)
      setShowAnswer(false)
      setTypedAnswer('')
      setQueue((q) => {
        if (!q) return q
        const rest = q.slice(1)
        if (updated.due.getTime() - now.getTime() < RELEARN_WINDOW_MS) {
          rest.push(updated)
        }
        return rest
      })
    },
    [card],
  )

  // Phím tắt 1 2 3 4 + Space (§8) — iPad có bàn phím rời thì ôn nhanh gấp đôi.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const typing = isTypingTarget()

      if (e.key === 'Enter' || (e.key === ' ' && !typing)) {
        e.preventDefault()
        if (showAnswer) void rate(3 as Grade)
        else reveal()
        return
      }
      if (showAnswer && !typing && e.key >= '1' && e.key <= '4') {
        e.preventDefault()
        void rate(Number(e.key) as Grade)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showAnswer, rate, reveal])

  if (queue === null) {
    return <Centered>Đang nạp…</Centered>
  }

  if (!card) {
    return (
      <div className="flex h-full flex-col">
        <Header deckName={deckName} left={queue.length} reviewed={reviewed} onExit={onExit} />
        <Centered>
          <div className="text-center">
            <div className="mb-2 text-4xl">🎉</div>
            <div className="mb-1 text-lg font-medium">Xong deck này rồi</div>
            <div className="text-sm text-slate-500">Đã ôn {reviewed} thẻ</div>
            <button onClick={onExit} className="mt-6 rounded-xl bg-slate-800 px-6 py-3 text-white">
              Về danh sách deck
            </button>
          </div>
        </Centered>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <Header deckName={deckName} left={queue.length} reviewed={reviewed} onExit={onExit} />

      {/* §8: khu vực thẻ dùng flex-1, KHÔNG dùng 100vh */}
      <div
        className="flex-1 overflow-y-auto px-4 py-6"
        onClick={() => !showAnswer && reveal()}
      >
        <div className="mx-auto max-w-2xl">
          {rendered ? (
            <>
              <CardView
                html={showAnswer ? rendered.back : rendered.front}
                css={rendered.css}
                onTyped={setTypedAnswer}
              />
              {!rendered.templated && (
                <p className="mt-6 rounded-lg bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-800">
                  Bộ thẻ này không kèm template (gói xuất theo schema v18), đang hiện dạng
                  thô. Xuất lại từ Anki với tuỳ chọn “Support older Anki versions” là thẻ
                  hiện đúng như trong Anki.
                </p>
              )}
            </>
          ) : (
            <div className="text-center text-slate-400">Note đã bị xoá</div>
          )}
        </div>
      </div>

      {showAnswer && intervals ? (
        <AnswerBar intervals={intervals} onRate={rate} />
      ) : (
        <ShowAnswerBar onShow={reveal} />
      )}
    </div>
  )
}

function Header({
  deckName,
  left,
  reviewed,
  onExit,
}: {
  deckName: string
  left: number
  reviewed: number
  onExit: () => void
}) {
  return (
    <div className="pt-safe flex items-center gap-3 border-b border-slate-200 bg-white px-3 pb-2">
      <button onClick={onExit} className="-ml-1 px-2 py-1 text-slate-500" aria-label="Quay lại">
        ←
      </button>
      <div className="min-w-0 flex-1 truncate text-sm font-medium">{deckName}</div>
      <div className="text-xs text-slate-500 tabular-nums">
        còn {left} · đã ôn {reviewed}
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-6 text-slate-500">{children}</div>
}
