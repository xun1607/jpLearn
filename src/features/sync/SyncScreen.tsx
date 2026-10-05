import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type FormEvent } from 'react'
import { db } from '../../db'
import { signIn, signOut, syncNow, useSyncStatus, type SyncStatus } from '../../sync/service'

export function SyncScreen({ onExit }: { onExit: () => void }) {
  const status = useSyncStatus()

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="pt-safe flex items-center gap-3 border-b border-slate-200 bg-white px-3 pb-2">
        <button onClick={onExit} className="-ml-1 px-2 py-1 text-slate-500">
          ←
        </button>
        <div className="flex-1 text-sm font-medium">Đồng bộ</div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl space-y-4">
          {status.account ? <SignedIn status={status} /> : <SignInForm />}
          <p className="text-xs leading-relaxed text-slate-400">
            Chỉ lịch sử ôn được đưa lên mạng. Mỗi máy tự tính lại lịch học từ lịch sử
            đó, nên học trên iPhone thì iPad cũng biết. Bộ thẻ <code>.apkg</code> vẫn
            phải nhập trên từng máy — nhập sau cũng được, tiến độ sẽ tự khôi phục.
          </p>
        </div>
      </div>
    </div>
  )
}

function SignInForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-600">
        Đăng nhập để giữ tiến độ học giữa iPhone và iPad.
      </p>
      <label className="block">
        <span className="mb-1 block text-xs text-slate-500">Email</span>
        <input
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-slate-500">Mật khẩu</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
        />
      </label>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button
        type="submit"
        disabled={busy || !email || !password}
        className="w-full rounded-xl bg-slate-800 py-3 text-base font-medium text-white disabled:bg-slate-300"
      >
        {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
      </button>
      <p className="text-xs leading-relaxed text-slate-400">
        Trên iPhone/iPad: đăng nhập <b>trong app đã cài ở Home Screen</b>, không phải
        trong tab Safari — hai nơi giữ dữ liệu riêng.
      </p>
    </form>
  )
}

function SignedIn({ status }: { status: SyncStatus }) {
  const pending = useLiveQuery(() => db.revlog.where('synced').equals(0).count(), [])
  const total = useLiveQuery(() => db.revlog.count(), [])
  const now = useNow(30_000)
  const result = status.lastResult

  return (
    <>
      <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
        <Row label="Tài khoản" value={status.account?.email ?? ''} />
        <Row
          label="Lần cuối"
          value={status.lastSyncAt ? formatAgo(now - status.lastSyncAt) : 'chưa đồng bộ lần nào'}
        />
        <Row
          label="Chờ đẩy lên"
          value={pending === undefined ? '…' : `${pending} lần ôn`}
          tone={pending ? 'warn' : undefined}
        />
        <Row label="Lịch sử trên máy" value={total === undefined ? '…' : `${total} lần ôn`} />
        {result && (
          <Row
            label="Lần vừa rồi"
            value={`đẩy ${result.pushed} · kéo ${result.pulled} · dựng lại ${result.rebuilt} thẻ`}
          />
        )}
        {status.phase === 'error' && status.error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{status.error}</p>
        )}
      </div>

      <button
        onClick={syncNow}
        disabled={status.phase === 'syncing'}
        className="w-full rounded-xl bg-emerald-500 py-3 text-base font-medium text-white disabled:bg-slate-300"
      >
        {status.phase === 'syncing' ? 'Đang đồng bộ…' : 'Đồng bộ ngay'}
      </button>

      <button
        onClick={() => void signOut()}
        className="w-full rounded-xl border border-slate-300 bg-white py-3 text-base text-slate-600 active:bg-slate-100"
      >
        Đăng xuất máy này
      </button>
      <p className="text-xs text-slate-400">
        Đăng xuất không xoá dữ liệu trên máy. Lần ôn làm lúc đã đăng xuất sẽ được
        đẩy lên khi đăng nhập lại.
      </p>
    </>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right ${tone === 'warn' ? 'text-amber-600' : 'text-slate-800'}`}>
        {value}
      </span>
    </div>
  )
}

/** Đồng hồ cho nhãn "x phút trước" — tự nhích, không phải bấm lại. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function formatAgo(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'vừa xong'
  if (minutes < 60) return `${minutes} phút trước`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} giờ trước`
  return `${Math.floor(hours / 24)} ngày trước`
}
