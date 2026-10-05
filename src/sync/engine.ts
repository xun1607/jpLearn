import type { LocalStore } from './local'
import type { SyncRemote } from './remote'

export const PUSH_BATCH = 500
export const PULL_PAGE = 1000

/**
 * Mỗi lần kéo lùi con trỏ lại một đoạn rồi lọc trùng bằng uid.
 *
 * `seq` cấp lúc INSERT bắt đầu chứ không phải lúc COMMIT: iPhone lấy seq 10
 * nhưng commit chậm, iPad lấy seq 11 commit trước. Máy kéo đúng lúc đó thấy
 * 11, nhớ con trỏ = 11, và dòng 10 bị bỏ sót vĩnh viễn. Kéo lùi một đoạn thì
 * lần sau vẫn vớt được; dòng đã có thì applyRemote tự bỏ qua.
 */
export const PULL_OVERLAP = 200

export interface SyncResult {
  pushed: number
  pulled: number
  rebuilt: number
}

/**
 * Một vòng đồng bộ: đẩy hết revlog chờ, rồi kéo phần mới về.
 *
 * Đẩy trước kéo sau để lần kéo này thấy luôn dữ liệu của chính mình — không
 * bắt buộc cho đúng, chỉ để con trỏ đi xa nhất có thể.
 * Lỗi mạng giữa chừng không làm hỏng gì: dòng chưa đánh dấu synced thì lần
 * sau đẩy lại (server bỏ qua trùng), con trỏ chỉ tiến sau khi đã ghi xong.
 */
export async function syncOnce(local: LocalStore, remote: SyncRemote): Promise<SyncResult> {
  let pushed = 0
  for (;;) {
    const batch = await local.pendingRevlog(PUSH_BATCH)
    if (batch.length === 0) break
    await remote.pushRevlog(batch)
    await local.markSynced(batch.map((r) => r.uid))
    pushed += batch.length
  }

  let pulled = 0
  let rebuilt = 0
  const start = await local.getCursor()
  let after = Math.max(0, start - PULL_OVERLAP)
  for (;;) {
    const page = await remote.pullRevlog(after, PULL_PAGE)
    if (page.length === 0) break
    const applied = await local.applyRemote(page)
    pulled += applied.added
    rebuilt += applied.rebuilt
    after = page[page.length - 1].seq
    if (after > start) await local.setCursor(after)
    if (page.length < PULL_PAGE) break
  }

  return { pushed, pulled, rebuilt }
}
