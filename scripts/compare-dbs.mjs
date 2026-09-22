/**
 * Kiểm chứng Bẫy 2 (§6): đếm note trong TỪNG collection.anki2* của gói,
 * xác nhận thứ tự anki21b -> anki21 -> anki2 chọn đúng file thật.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { decompress } from 'fzstd'

const require = createRequire(import.meta.url)
const initSqlJs = require('sql.js')
const SQL = await initSqlJs()

for (const file of process.argv.slice(2)) {
  console.log(`\n=== ${path.basename(file)}`)
  const zip = unzipSync(new Uint8Array(readFileSync(file)))
  for (const name of ['collection.anki21b', 'collection.anki21', 'collection.anki2']) {
    if (!zip[name]) continue
    let bytes = zip[name]
    if (bytes[0] === 0x28 && bytes[1] === 0xb5) bytes = decompress(bytes)
    const db = new SQL.Database(bytes)
    const count = (sql) => {
      try {
        const s = db.prepare(sql)
        s.step()
        const v = s.get()[0]
        s.free()
        return v
      } catch (e) {
        return `n/a (${e.message.slice(0, 30)})`
      }
    }
    const models = count("SELECT length(models) FROM col LIMIT 1")
    console.log(
      `  ${name.padEnd(20)} notes=${String(count('SELECT count(*) FROM notes')).padEnd(6)}` +
        ` cards=${String(count('SELECT count(*) FROM cards')).padEnd(6)}` +
        ` len(col.models)=${models}`,
    )
    db.close()
  }
}
