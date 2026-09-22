/**
 * Smoke test end-to-end chạy bằng Node + fake-indexeddb.
 *
 *   npm run smoke -- "D:/DOWNLOAD/deck.apkg"
 *
 * Phủ đúng đường mà app đi: parse .apkg -> ghi Dexie -> dựng hàng đợi ->
 * chấm điểm -> kiểm tra thẻ rời hàng đợi và revlog có bản ghi.
 * Có nó thì lỗi schema/index Dexie lộ ra ở đây chứ không phải trên iPhone.
 */
import 'fake-indexeddb/auto'
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

// DOMPurify chỉ tự kích hoạt khi có `window`; cấp một DOM giả trƯỚC khi nạp
// code app, không thì sanitize thành hàm rỗng và test mất ý nghĩa.
const dom = new JSDOM('')
dom.window.indexedDB = globalThis.indexedDB
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.Node = dom.window.Node
globalThis.DocumentFragment = dom.window.DocumentFragment
globalThis.NodeFilter = dom.window.NodeFilter
globalThis.HTMLTemplateElement = dom.window.HTMLTemplateElement

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')

let passed = 0
function check(label, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${label}`)
  } catch (err) {
    console.log(`  ✗ ${label}\n      ${err.message}`)
    process.exitCode = 1
  }
}

async function loadApp() {
  const outfile = path.join(root, 'node_modules/.cache/apkg/smoke.mjs')
  mkdirSync(path.dirname(outfile), { recursive: true })
  await build({
    entryPoints: [path.join(root, 'scripts/smoke-entry.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    packages: 'external',
    logLevel: 'error',
  })
  return import(pathToFileURL(outfile).href)
}

const app = await loadApp()
const {
  parseApkg,
  importCollection,
  db,
  seedIfEmpty,
  addNote,
  BASIC_NOTETYPE_ID,
  DEFAULT_DECK_ID,
  buildQueue,
  deckCounts,
  applyRating,
  previewIntervals,
  formatInterval,
  Rating,
  State,
  renderFront,
  renderBack,
} = app

// ---------------------------------------------------------------- 1. thẻ gõ tay

console.log('\n[1] Thẻ gõ tay + vòng ôn')
await seedIfEmpty()
await addNote(DEFAULT_DECK_ID, BASIC_NOTETYPE_ID, ['猫', 'con mèo'])
await addNote(DEFAULT_DECK_ID, BASIC_NOTETYPE_ID, ['犬', 'con chó'])

let counts = await deckCounts(DEFAULT_DECK_ID)
check('2 note gõ tay -> 2 thẻ mới', () => assert.equal(counts.new, 2))
check('chưa có thẻ nào tới hạn', () => assert.equal(counts.due, 0))

let queue = await buildQueue(DEFAULT_DECK_ID)
check('hàng đợi có 2 thẻ', () => assert.equal(queue.length, 2))

const firstCard = queue[0]
const intervals = previewIntervals(firstCard)
check('4 nút đều có nhãn thời gian', () =>
  assert.equal(Object.keys(intervals).length, 4, JSON.stringify(intervals)),
)
check('Easy xa hơn Again', () => {
  const again = previewIntervals(firstCard)
  const ms = (g) => {
    const p = applyRating(firstCard, g)
    return p.card.due.getTime() - Date.now()
  }
  assert.ok(ms(Rating.Easy) > ms(Rating.Again), JSON.stringify(again))
})

// chấm Good rồi kiểm tra ghi nhận
const now = new Date()
const { card: nextCard, log } = applyRating(firstCard, Rating.Good, now)
await db.cards.put({ ...firstCard, ...nextCard })
await db.revlog.add({
  cardId: firstCard.id,
  rating: log.rating,
  state: log.state,
  elapsedDays: log.elapsed_days,
  scheduledDays: log.scheduled_days,
  reviewedAt: now,
})

const stored = await db.cards.get(firstCard.id)
check('thẻ rời trạng thái New', () => assert.notEqual(stored.state, State.New))
check('due đã đẩy về tương lai', () => assert.ok(stored.due.getTime() > now.getTime()))
check('stability > 0', () => assert.ok(stored.stability > 0))
const revlogCount = await db.revlog.count()
check('revlog có 1 bản ghi', () => assert.equal(revlogCount, 1))
check('revlog ghi state TRƯỚC khi ôn = New', () => assert.equal(log.state, State.New))

queue = await buildQueue(DEFAULT_DECK_ID)
check('thẻ vừa ôn rời hàng đợi', () => assert.ok(!queue.some((c) => c.id === firstCard.id)))

// ---------------------------------------------------------------- 2. nhãn thời gian

console.log('\n[2] Nhãn khoảng thời gian')
check('60s -> "1 phút"', () => assert.equal(formatInterval(60_000), '1 phút'))
check('6 ngày', () => assert.equal(formatInterval(6 * 86_400_000), '6 ngày'))
check('sang tháng', () => assert.equal(formatInterval(45 * 86_400_000), '1,5 tháng'))

// ---------------------------------------------------------------- 3. import .apkg

const file = process.argv[2]
if (!file) {
  console.log('\n[3] Bỏ qua import — chưa truyền đường dẫn .apkg')
} else {
  console.log(`\n[3] Import ${path.basename(file)}`)
  const initSqlJs = require('sql.js')
  const SQL = await initSqlJs()
  const col = parseApkg(new Uint8Array(readFileSync(file)), SQL)
  const summary = await importCollection(col)

  console.log(
    `    schema=${summary.schema} deck=${summary.decks.length} note=${summary.notes} thẻ mới=${summary.newCards} media=${summary.media}`,
  )
  check('có note được nhập', () => assert.ok(summary.notes > 0))
  check('có thẻ được nhập', () => assert.ok(summary.newCards > 0))
  check('không nhập deck rỗng "Default"', () =>
    assert.ok(!summary.decks.includes('Default'), summary.decks.join(' | ')),
  )

  const importedDecks = await db.decks.toArray()
  const target = importedDecks.find((d) => d.name !== 'Mặc định')
  const importedCounts = await deckCounts(target.id)
  check('Bẫy 3: mọi thẻ nhập vào đều ở trạng thái New', () =>
    assert.ok(importedCounts.new > 0),
  )
  check('không thẻ nào tới hạn ngay', () => assert.equal(importedCounts.due, 0))

  const nonNew = await db.cards.where('deckId').equals(target.id).filter((c) => c.state !== State.New).count()
  check('không sót dữ liệu lịch SM-2', () => assert.equal(nonNew, 0))

  // render thô
  const sampleCard = (await db.cards.where('deckId').equals(target.id).limit(1).toArray())[0]
  const sampleNote = await db.notes.get(sampleCard.noteId)
  const notetype = await db.notetypes.get(sampleNote.notetypeId)
  const front = renderFront(sampleNote)
  const back = renderBack(sampleNote, notetype)
  check('mặt trước không rỗng', () => assert.ok(front.trim().length > 0, JSON.stringify(front)))
  check('mặt sau không rỗng', () => assert.ok(back.trim().length > 0))
  check('mặt sau có nhãn tên field', () => assert.ok(back.includes('uppercase')))

  // §7: HTML trong bộ thẻ tải về là code của người lạ — phải bị lọc.
  const evil = {
    fields: [
      '<img src=x onerror=alert(1)>câu hỏi<script>alert(2)<\/script>',
      '<a href="javascript:alert(3)">đáp án</a>',
    ],
  }
  const evilFront = renderFront(evil)
  const evilBack = renderBack(evil, { fields: ['A', 'B'] })
  check('sanitize: bỏ <script>', () => assert.ok(!/<script/i.test(evilFront)))
  check('sanitize: bỏ onerror=', () => assert.ok(!/onerror/i.test(evilFront)))
  check('sanitize: bỏ javascript: href', () => assert.ok(!/javascript:/i.test(evilBack)))
  check('sanitize: giữ lại nội dung lành', () => assert.ok(evilFront.includes('câu hỏi')))
  console.log(`    mặt trước mẫu: ${front.replace(/<[^>]*>/g, '').trim().slice(0, 60)}`)

  // nhập lại lần hai không được nhân đôi hay xoá tiến độ
  const cardsBefore = await db.cards.count()
  const second = await importCollection(col)
  const cardsAfter = await db.cards.count()
  check('nhập lại không nhân đôi thẻ', () => assert.equal(cardsBefore, cardsAfter))
  check('nhập lại giữ nguyên thẻ cũ', () => assert.ok(second.keptCards > 0))

  // hạn mức thẻ mới mỗi ngày
  const limited = await buildQueue(target.id, 20)
  check('hàng đợi tôn trọng hạn mức 20 thẻ mới/ngày', () => assert.ok(limited.length <= 20))
}

console.log(`\n${passed} kiểm tra đạt${process.exitCode ? ' — CÓ LỖI Ở TRÊN' : ''}`)
await db.close()
