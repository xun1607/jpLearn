import initSqlJs from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { parseApkg } from '../lib/apkg/parse'
import type { ParsedCollection } from '../lib/apkg/types'

/**
 * §3: import .apkg PHẢI chạy trong Web Worker — bộ 20k thẻ sẽ đóng băng UI
 * vài giây nếu parse ở luồng chính.
 *
 * Worker chỉ parse rồi trả kết quả; việc ghi Dexie để luồng chính làm, vì
 * useLiveQuery ở đó mới thấy thay đổi ngay.
 */

export type ImportRequest = { file: ArrayBuffer }

export type ImportResponse =
  | { type: 'progress'; phase: string; done?: number; total?: number }
  | { type: 'done'; collection: ParsedCollection }
  | { type: 'error'; message: string }

const post = (msg: ImportResponse) => self.postMessage(msg)

self.onmessage = async (event: MessageEvent<ImportRequest>) => {
  try {
    post({ type: 'progress', phase: 'Khởi động bộ đọc SQLite' })
    const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl })

    const collection = parseApkg(new Uint8Array(event.data.file), SQL, (phase, done, total) =>
      post({ type: 'progress', phase, done, total }),
    )

    post({ type: 'done', collection })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
