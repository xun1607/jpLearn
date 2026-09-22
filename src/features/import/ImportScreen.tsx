export function ImportScreen({ onExit }: { onExit: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-slate-500">
      <div>Màn nhập .apkg — đang làm</div>
      <button onClick={onExit} className="rounded-xl bg-slate-800 px-6 py-3 text-white">
        Quay lại
      </button>
    </div>
  )
}
