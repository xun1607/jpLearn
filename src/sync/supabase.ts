import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { PulledRevlog, RevlogRecord, SyncRemote } from './remote'

/**
 * Publishable key được phép nằm trong code frontend — Supabase thiết kế nó
 * để lộ ra. Thứ bảo vệ dữ liệu là RLS trong supabase/schema.sql, không phải
 * việc giấu key. Biến môi trường chỉ để trỏ sang project khác khi cần.
 * TUYỆT ĐỐI không đặt secret / service_role key ở đây.
 */
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://mcdqjcrhlathzwxzmbin.supabase.co'
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_89wBzewNIS4bfKYMdciE9A_A6H5n2f3'

let client: SupabaseClient | null = null

export function supabase(): SupabaseClient {
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Không dùng magic link: trên iOS link trong mail mở bằng Safari chứ
      // không vào app đã cài, nên đăng nhập bằng email + mật khẩu.
      detectSessionInUrl: false,
    },
  })
  return client
}

interface ServerRevlog {
  uid: string
  card_id: number
  rating: number
  state: number
  elapsed_days: number
  scheduled_days: number
  reviewed_at: string
  seq: number
}

const COLUMNS = 'uid,card_id,rating,state,elapsed_days,scheduled_days,reviewed_at,seq'

function toServer(row: RevlogRecord): Omit<ServerRevlog, 'seq'> {
  return {
    uid: row.uid,
    card_id: row.cardId,
    rating: row.rating,
    state: row.state,
    elapsed_days: row.elapsedDays,
    scheduled_days: row.scheduledDays,
    reviewed_at: row.reviewedAt.toISOString(),
  }
}

function fromServer(row: ServerRevlog): PulledRevlog {
  return {
    uid: row.uid,
    cardId: Number(row.card_id),
    rating: row.rating,
    state: row.state,
    elapsedDays: row.elapsed_days,
    scheduledDays: row.scheduled_days,
    // timestamptz giữ tới micro-giây nên mili-giây của Date đi về nguyên vẹn —
    // quan trọng vì seed fuzz của ts-fsrs lấy đúng con số này.
    reviewedAt: new Date(row.reviewed_at),
    seq: Number(row.seq),
  }
}

export function supabaseRemote(sb: SupabaseClient = supabase()): SyncRemote {
  return {
    async pushRevlog(rows) {
      if (rows.length === 0) return
      // ignoreDuplicates = INSERT … ON CONFLICT (uid) DO NOTHING: đẩy lại dòng
      // đã có (lần trước mất mạng sau khi server đã nhận) không phải là lỗi.
      const { error } = await sb
        .from('revlog')
        .upsert(rows.map(toServer), { onConflict: 'uid', ignoreDuplicates: true })
      if (error) throw new SyncError(error.message, error.code)
    },

    async pullRevlog(after, limit) {
      const { data, error } = await sb
        .from('revlog')
        .select(COLUMNS)
        .gt('seq', after)
        .order('seq', { ascending: true })
        .limit(limit)
      if (error) throw new SyncError(error.message, error.code)
      return (data as ServerRevlog[]).map(fromServer)
    },
  }
}

export class SyncError extends Error {
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}
