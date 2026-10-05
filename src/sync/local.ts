import type { FlashcardDB } from '../db'
import { rebuildCards } from '../db/review'
import type { RevlogRecord } from './remote'

/** Phía máy của đồng bộ: engine đọc/ghi IndexedDB qua đây chứ không gọi Dexie trực tiếp. */
export interface LocalStore {
  /** Revlog ghi trên máy này mà chưa lên server. */
  pendingRevlog(limit: number): Promise<RevlogRecord[]>
  markSynced(uids: readonly string[]): Promise<void>
  /**
   * Ghi revlog kéo về rồi dựng lại các thẻ bị ảnh hưởng — trong CÙNG một
   * transaction. Tách đôi thì app tắt giữa chừng sẽ để lại revlog đã ghi mà
   * thẻ chưa dựng lại, và lần sau dòng đó bị coi là trùng nên không ai sửa.
   */
  applyRemote(rows: readonly RevlogRecord[]): Promise<{ added: number; rebuilt: number }>
  getCursor(): Promise<number>
  setCursor(seq: number): Promise<void>
}

/** Bỏ trường cục bộ (id, synced) và trường của server (seq). */
function toRecord(row: RevlogRecord): RevlogRecord {
  return {
    uid: row.uid,
    cardId: row.cardId,
    rating: row.rating,
    state: row.state,
    elapsedDays: row.elapsedDays,
    scheduledDays: row.scheduledDays,
    reviewedAt: row.reviewedAt,
  }
}

/**
 * @param scope tách con trỏ theo tài khoản: đăng xuất rồi vào tài khoản khác
 *              thì phải kéo lại từ đầu chứ không dùng con trỏ của người trước.
 */
export function dexieStore(db: FlashcardDB, scope: string): LocalStore {
  const cursorKey = `sync:revlogCursor:${scope}`

  return {
    async pendingRevlog(limit) {
      const rows = await db.revlog.where('synced').equals(0).limit(limit).toArray()
      return rows.map(toRecord)
    },

    async markSynced(uids) {
      await db.transaction('rw', db.revlog, async () => {
        await db.revlog.where('uid').anyOf([...uids]).modify({ synced: 1 })
      })
    },

    async applyRemote(rows) {
      return db.transaction('rw', db.revlog, db.cards, async () => {
        const known = new Set(
          (await db.revlog.where('uid').anyOf(rows.map((r) => r.uid)).toArray()).map((r) => r.uid),
        )
        const fresh = rows.filter((r) => !known.has(r.uid))
        if (fresh.length === 0) return { added: 0, rebuilt: 0 }

        await db.revlog.bulkAdd(fresh.map((r) => ({ ...toRecord(r), synced: 1 as const })))
        const rebuilt = await rebuildCards(new Set(fresh.map((r) => r.cardId)), db)
        return { added: fresh.length, rebuilt }
      })
    },

    async getCursor() {
      const row = await db.config.get(cursorKey)
      return typeof row?.value === 'number' ? row.value : 0
    },

    async setCursor(seq) {
      await db.config.put({ key: cursorKey, value: seq })
    },
  }
}
