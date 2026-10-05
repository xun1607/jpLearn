/**
 * Hợp đồng giữa engine đồng bộ và nơi lưu trên mạng.
 *
 * Engine chỉ biết interface này, không biết Supabase. Test dùng
 * `memoryRemote`, app dùng `supabaseRemote` — đổi chỗ lưu chỉ phải viết lại
 * một file, engine không đụng tới.
 */

/** Một dòng revlog ở dạng trao đổi, không kèm trường cục bộ (id, synced). */
export interface RevlogRecord {
  uid: string
  cardId: number
  rating: number
  state: number
  elapsedDays: number
  scheduledDays: number
  reviewedAt: Date
}

export interface PulledRevlog extends RevlogRecord {
  /** Số thứ tự do server cấp, tăng dần. Máy dùng nó làm con trỏ kéo về. */
  seq: number
}

export interface SyncRemote {
  /** Đẩy lên. Dòng trùng `uid` với dòng đã có thì bị bỏ qua, không báo lỗi. */
  pushRevlog(rows: readonly RevlogRecord[]): Promise<void>
  /** Các dòng có `seq > after`, xếp tăng dần theo `seq`, tối đa `limit` dòng. */
  pullRevlog(after: number, limit: number): Promise<PulledRevlog[]>
}
