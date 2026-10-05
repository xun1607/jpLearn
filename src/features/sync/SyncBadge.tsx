import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { useSyncStatus } from '../../sync/service'
import { formatAgo, useNow } from './SyncScreen'

/** Một dòng trạng thái trên danh sách deck — nhìn là biết tiến độ đã lên mạng chưa. */
export function SyncBadge({ onOpen }: { onOpen: () => void }) {
  const status = useSyncStatus()
  const pending = useLiveQuery(() => db.revlog.where('synced').equals(0).count(), [])
  const now = useNow(30_000)

  let text: string
  let tone = 'text-slate-400'
  if (!status.account) {
    text = 'Chưa bật đồng bộ — chạm để đăng nhập'
    tone = 'text-amber-600'
  } else if (status.phase === 'syncing') {
    text = 'Đang đồng bộ…'
  } else if (status.phase === 'error') {
    text = `Chưa đồng bộ được${pending ? ` · ${pending} lần ôn đang chờ` : ''}`
    tone = 'text-rose-600'
  } else if (status.lastSyncAt) {
    text = `Đã đồng bộ ${formatAgo(now - status.lastSyncAt)}`
  } else {
    text = 'Sắp đồng bộ…'
  }

  return (
    <button
      onClick={onOpen}
      className={`mt-2 flex w-full items-center gap-1.5 text-left text-xs ${tone}`}
    >
      <span aria-hidden>☁</span>
      <span className="flex-1 truncate">{text}</span>
      <span className="text-slate-300">›</span>
    </button>
  )
}
