import { liveQuery } from 'dexie'
import { useSyncExternalStore } from 'react'
import { db } from '../db'
import type { Account } from './auth'
import { syncOnce, type SyncResult } from './engine'
import { dexieStore } from './local'

// supabase-js nặng ~60KB gzip mà lúc mở app chưa cần: nạp sau, để màn ôn hiện
// ngay. Service worker vẫn precache chunk này nên offline không ảnh hưởng.
const loadAuth = () => import('./auth')
const loadSupabase = () => import('./supabase')

export async function signIn(email: string, password: string): Promise<void> {
  await (await loadAuth()).signIn(email, password)
}

export async function signOut(): Promise<void> {
  await (await loadAuth()).signOut()
}

/**
 * Lớp điều phối: QUYẾT ĐỊNH KHI NÀO đồng bộ. Còn đồng bộ thế nào là việc
 * của engine — tách ra để engine test được bằng Node mà không cần timer,
 * sự kiện trình duyệt hay đăng nhập.
 */

export interface SyncStatus {
  account: Account | null
  phase: 'off' | 'idle' | 'syncing' | 'error'
  lastSyncAt: number | null
  lastResult: SyncResult | null
  error: string | null
}

/** Gom các lần chấm liền nhau thành một lần đẩy. */
const PUSH_DELAY_MS = 3_000
/** Hai máy cùng mở: kéo định kỳ để máy kia thấy được tiến độ mà không phải đóng/mở app. */
const POLL_MS = 5 * 60_000
const LAST_SYNC_KEY = 'sync:lastAt'

let status: SyncStatus = {
  account: null,
  phase: 'off',
  lastSyncAt: Number(localStorage.getItem(LAST_SYNC_KEY)) || null,
  lastResult: null,
  error: null,
}
const listeners = new Set<() => void>()

function update(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch }
  for (const listener of listeners) listener()
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => status,
  )
}

let timer: ReturnType<typeof setTimeout> | undefined
let dueAt = Infinity
let running = false
let again = false

/**
 * Hẹn một vòng đồng bộ sau `delayMs`. Đã có lịch sớm hơn thì giữ lịch đó —
 * ôn liên tục cũng không đẩy lùi mãi lần đẩy lên.
 */
export function requestSync(delayMs = 0): void {
  if (!status.account) return
  const at = Date.now() + delayMs
  if (at >= dueAt) return
  clearTimeout(timer)
  dueAt = at
  timer = setTimeout(() => void run(), delayMs)
}

async function run(): Promise<void> {
  dueAt = Infinity
  clearTimeout(timer)
  const account = status.account
  if (!account) return
  if (running) {
    again = true
    return
  }

  running = true
  update({ phase: 'syncing', error: null })
  try {
    const { supabaseRemote } = await loadSupabase()
    const result = await syncOnce(dexieStore(db, account.id), supabaseRemote())
    const now = Date.now()
    localStorage.setItem(LAST_SYNC_KEY, String(now))
    update({ phase: 'idle', lastSyncAt: now, lastResult: result })
  } catch (err) {
    // Không thử lại dồn dập: lần sau là khi có mạng lại, mở app, hoặc tới kỳ kéo
    // định kỳ. Revlog vẫn nằm chờ trên máy nên không mất gì.
    update({ phase: 'error', error: explainSyncError(err) })
  } finally {
    running = false
    if (again) {
      again = false
      requestSync(0)
    }
  }
}

/** Gọi một lần lúc mở app. Trả hàm dọn dẹp. */
export function startSyncService(): () => void {
  const cleanups: Array<() => void> = []

  let stopped = false
  cleanups.push(() => {
    stopped = true
  })
  void loadAuth().then(({ onAccountChange }) => {
    if (stopped) return
    cleanups.push(
      onAccountChange((account) => {
        const changed = account?.id !== status.account?.id
        update({
          account,
          phase: account ? (status.phase === 'off' ? 'idle' : status.phase) : 'off',
          error: account ? status.error : null,
        })
        if (account && changed) requestSync(0)
      }),
    )
  })

  // Có revlog chưa đẩy (vừa chấm điểm, hoặc còn tồn từ lần mất mạng) thì hẹn đẩy.
  // Theo dõi dữ liệu thay vì để màn ôn gọi sang: tầng ôn thẻ khỏi phải biết
  // gì về đồng bộ.
  const pending = liveQuery(() => db.revlog.where('synced').equals(0).count()).subscribe({
    next: (count) => {
      if (count > 0) requestSync(PUSH_DELAY_MS)
    },
  })
  cleanups.push(() => pending.unsubscribe())

  const onVisibility = () => {
    // Rời app: đẩy NGAY, iOS sắp đóng băng trang và timer sẽ không chạy nữa.
    if (document.visibilityState === 'hidden') void run()
    else requestSync(0)
  }
  const onOnline = () => requestSync(0)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', onOnline)
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility))
  cleanups.push(() => window.removeEventListener('online', onOnline))

  const poll = setInterval(() => {
    if (document.visibilityState === 'visible') requestSync(0)
  }, POLL_MS)
  cleanups.push(() => clearInterval(poll))

  return () => cleanups.forEach((fn) => fn())
}

export function syncNow(): void {
  void run()
}

function explainSyncError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  // Không dùng instanceof SyncError: import class đó là kéo cả supabase-js vào chunk chính.
  const code = (err as { code?: string } | null)?.code
  if (code === 'PGRST205' || /could not find the table/i.test(message)) {
    return 'Chưa tạo bảng trên Supabase — chạy file supabase/schema.sql trong SQL Editor.'
  }
  if (code === '42501' || /permission denied|row-level security/i.test(message)) {
    return 'Server từ chối quyền — kiểm tra lại phần policy trong supabase/schema.sql.'
  }
  if (/jwt|token/i.test(message)) return 'Phiên đăng nhập hết hạn — đăng xuất rồi đăng nhập lại.'
  if (/fetch|network|timeout|5\d\d/i.test(message)) {
    return 'Không kết nối được máy chủ. Dữ liệu vẫn an toàn trên máy, sẽ tự thử lại.'
  }
  return message
}
