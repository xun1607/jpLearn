import { GRADES, GRADE_LABEL, Rating, type Grade } from '../../scheduler'

const STYLE: Record<Grade, string> = {
  [Rating.Again]: 'bg-rose-500 active:bg-rose-600',
  [Rating.Hard]: 'bg-amber-500 active:bg-amber-600',
  [Rating.Good]: 'bg-emerald-500 active:bg-emerald-600',
  [Rating.Easy]: 'bg-sky-500 active:bg-sky-600',
}

export function AnswerBar({
  intervals,
  onRate,
}: {
  intervals: Record<Grade, string>
  onRate: (grade: Grade) => void
}) {
  return (
    <div className="pb-safe border-t border-slate-200 bg-white px-2 pt-2">
      <div className="mx-auto flex max-w-2xl gap-2">
        {GRADES.map((grade) => (
          <button
            key={grade}
            onClick={() => onRate(grade)}
            className={`flex-1 rounded-xl py-3 text-white ${STYLE[grade]}`}
          >
            <div className="text-base leading-tight font-medium">{GRADE_LABEL[grade]}</div>
            <div className="text-[11px] leading-tight opacity-90">{intervals[grade]}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

export function ShowAnswerBar({ onShow }: { onShow: () => void }) {
  return (
    <div className="pb-safe border-t border-slate-200 bg-white px-2 pt-2">
      <div className="mx-auto max-w-2xl">
        <button
          onClick={onShow}
          className="w-full rounded-xl bg-slate-800 py-4 text-base font-medium text-white active:bg-slate-900"
        >
          Hiện đáp án
        </button>
      </div>
    </div>
  )
}
