import type { PulledRevlog, RevlogRecord, SyncRemote } from './remote'

/**
 * Server giả trong bộ nhớ — chỉ dùng cho test, app không import file này.
 * Bắt chước đúng những gì Supabase hứa: bỏ qua trùng uid, cấp seq tăng dần.
 */
export interface MemoryRemote extends SyncRemote {
  rows: PulledRevlog[]
  /** Số lần gọi mạng, để test biết engine có gọi thừa không. */
  calls: number
  /** Làm request kế tiếp thất bại, giả lập mất mạng giữa chừng. */
  failNext: number
  /**
   * Giả lập dòng commit muộn: chèn một dòng mang seq CŨ hơn con trỏ mà máy
   * khác đã đi qua (xem PULL_OVERLAP trong engine).
   */
  insertLate(row: RevlogRecord, seq: number): void
}

export function memoryRemote(): MemoryRemote {
  let nextSeq = 1
  const remote: MemoryRemote = {
    rows: [],
    calls: 0,
    failNext: 0,

    async pushRevlog(rows) {
      remote.calls++
      if (remote.failNext > 0) {
        remote.failNext--
        throw new Error('mất mạng (giả lập)')
      }
      const known = new Set(remote.rows.map((r) => r.uid))
      for (const row of rows) {
        if (known.has(row.uid)) continue
        known.add(row.uid)
        remote.rows.push({ ...row, reviewedAt: new Date(row.reviewedAt), seq: nextSeq++ })
      }
    },

    async pullRevlog(after, limit) {
      remote.calls++
      if (remote.failNext > 0) {
        remote.failNext--
        throw new Error('mất mạng (giả lập)')
      }
      return remote.rows
        .filter((r) => r.seq > after)
        .sort((a, b) => a.seq - b.seq)
        .slice(0, limit)
        .map((r) => ({ ...r, reviewedAt: new Date(r.reviewedAt) }))
    },

    insertLate(row, seq) {
      remote.rows.push({ ...row, seq })
    },
  }
  return remote
}
