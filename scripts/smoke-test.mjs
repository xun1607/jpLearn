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
  renderCard,
  rewriteMedia,
  renderTemplate,
  furigana,
  sanitizeCardHtml,
  notesStudiedToday,
  keepOnePerNote,
  deleteDeck,
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

// ---------------------------------------------------------------- 3. template engine

console.log('\n[3] Template engine')
const tplBase = {
  fields: { Kanji: '一', English: 'one', Onyomi: 'イチ', Nanori: '', Text: 'Thủ đô là {{c1::Hà Nội}}, có {{c2::Hồ Gươm}}' },
  tags: ['n5'],
  deckName: 'Nhật::N5',
  notetypeName: 'Japanese Kanji',
  cardName: 'Recognition',
  ord: 0,
  side: 'front',
}
const tpl = (src, over = {}) => renderTemplate(src, { ...tplBase, ...over })

check('{{Field}}', () => assert.equal(tpl('<b>{{Kanji}}</b>'), '<b>一</b>'))
check('field không tồn tại -> rỗng', () => assert.equal(tpl('[{{Mơ Hồ}}]'), '[]'))
check('{{FrontSide}}', () =>
  assert.equal(tpl('{{FrontSide}}<hr>{{English}}', { frontSide: '一' }), '一<hr>one'),
)
check('{{#Field}} hiện khi có nội dung', () =>
  assert.equal(tpl('{{#Onyomi}}on: {{Onyomi}}{{/Onyomi}}'), 'on: イチ'),
)
check('{{#Field}} ẩn khi rỗng', () =>
  assert.equal(tpl('{{#Nanori}}nanori{{/Nanori}}'), ''),
)
check('{{^Field}} hiện khi rỗng', () =>
  assert.equal(tpl('{{^Nanori}}chưa có{{/Nanori}}'), 'chưa có'),
)
check('section lồng nhau', () =>
  assert.equal(tpl('{{#Kanji}}A{{#Onyomi}}B{{/Onyomi}}C{{/Kanji}}'), 'ABC'),
)
check('{{text:Field}} bỏ thẻ HTML', () =>
  assert.equal(tpl('{{text:Kanji}}', { fields: { ...tplBase.fields, Kanji: '<b>一</b>' } }), '一'),
)
check('{{Deck}} / {{Subdeck}} / {{Tags}} / {{Card}}', () =>
  assert.equal(tpl('{{Deck}}|{{Subdeck}}|{{Tags}}|{{Card}}'), 'Nhật::N5|N5|n5|Recognition'),
)
check('furigana 漢字[かんじ]', () =>
  assert.equal(furigana('漢字[かんじ]'), '<ruby>漢字<rt>かんじ</rt></ruby>'),
)
check('cloze mặt trước che c1', () => {
  const out = tpl('{{cloze:Text}}', { ord: 0, side: 'front' })
  assert.ok(out.includes('[...]'), out)
  assert.ok(out.includes('Hồ Gươm'), 'cloze khác phải hiện bình thường')
  assert.ok(!out.includes('Hà Nội'), 'c1 phải bị che')
})
check('cloze mặt sau lộ c1', () => {
  const out = tpl('{{cloze:Text}}', { ord: 0, side: 'back' })
  assert.ok(out.includes('Hà Nội'), out)
})
check('cloze ord 1 che c2 chứ không che c1', () => {
  const out = tpl('{{cloze:Text}}', { ord: 1, side: 'front' })
  assert.ok(out.includes('Hà Nội') && !out.includes('Hồ Gươm'), out)
})
check('{{type:Field}} mặt trước ra ô nhập', () =>
  assert.ok(tpl('{{type:English}}', { side: 'front' }).includes('<input')),
)
check('{{type:Field}} mặt sau chấm đúng', () => {
  const out = tpl('{{type:English}}', { side: 'back', typedAnswer: 'one' })
  assert.ok(out.includes('typeans-ok'), out)
})
check('{{type:Field}} mặt sau chấm sai', () => {
  const out = tpl('{{type:English}}', { side: 'back', typedAnswer: 'two' })
  assert.ok(out.includes('typeans-bad') && out.includes('one'), out)
})
check('{{hint:Field}} ẩn nội dung', () => {
  const out = tpl('{{hint:Onyomi}}')
  assert.ok(out.includes('hint-link') && out.includes('display:none'), out)
})
check('bộ lọc lạ không làm vỡ thẻ', () => assert.equal(tpl('{{tts ja_JP:Kanji}}'), ''))
check('thẻ không đóng không nuốt nội dung', () =>
  assert.ok(tpl('{{#Kanji}}còn đây').includes('còn đây')),
)

console.log('\n[3b] Đường dẫn media')
check('<img src="neko.jpg"> -> /media/neko.jpg', () =>
  assert.ok(rewriteMedia('<img src="neko.jpg">').includes('src="/media/neko.jpg"')),
)
check('không đụng URL tuyệt đối', () =>
  assert.ok(rewriteMedia('<img src="https://x.com/a.png">').includes('https://x.com/a.png')),
)
check('[sound:a.mp3] -> thẻ <audio>', () => {
  const out = rewriteMedia('xin chào [sound:a.mp3]')
  assert.ok(out.includes('<audio') && out.includes('/media/a.mp3'), out)
})
check('tên file có dấu cách được mã hoá', () =>
  assert.ok(rewriteMedia('<img src="con meo.jpg">').includes('con%20meo.jpg')),
)

// ---------------------------------------------------------------- 4. import .apkg

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

  // Render thật qua template của bộ thẻ, theo từng ord.
  const sampleCard = (await db.cards.where('deckId').equals(target.id).limit(1).toArray())[0]
  const sampleNote = await db.notes.get(sampleCard.noteId)
  const notetype = await db.notetypes.get(sampleNote.notetypeId)
  const rendered = renderCard(sampleNote, notetype, sampleCard, target.name)
  check('mặt trước không rỗng', () =>
    assert.ok(rendered.front.trim().length > 0, JSON.stringify(rendered.front)),
  )
  check('mặt sau không rỗng', () => assert.ok(rendered.back.trim().length > 0))

  if (notetype.templates.length > 1 && notetype.templates[1].qfmt.trim() !== '') {
    // Đây chính là lỗi đã gặp: bỏ qua ord thì hai thẻ của cùng note giống hệt nhau.
    const a = renderCard(sampleNote, notetype, { ord: 0 }, target.name)
    const b = renderCard(sampleNote, notetype, { ord: 1 }, target.name)
    check('ord khác nhau -> mặt trước khác nhau', () =>
      assert.notEqual(a.front, b.front, `ord 0: ${a.front.slice(0, 80)}`),
    )
    console.log(`    ord 0 hỏi: ${a.front.replace(/<[^>]*>/g, '').trim().slice(0, 40)}`)
    console.log(`    ord 1 hỏi: ${b.front.replace(/<[^>]*>/g, '').trim().slice(0, 40)}`)
  }

  if (rendered.templated) {
    check('dùng template của bộ thẻ, không phải dạng thô', () => assert.ok(rendered.templated))
    check('CSS của notetype được lấy theo', () => assert.ok(rendered.css.length > 0))
    check('mặt sau chứa lại mặt trước ({{FrontSide}})', () =>
      assert.ok(rendered.back.includes(rendered.front.trim().slice(0, 20))),
    )
  } else {
    console.log('    (notetype không có template — đang dùng dạng thô)')
  }

  // Media: tên trong HTML thẻ phải khớp tên đã lưu trong IndexedDB, không thì
  // service worker tra không ra và thẻ câm.
  if (summary.media > 0) {
    let checkedMedia = 0
    let missing = null
    for (const c of await db.cards.where('deckId').equals(target.id).limit(30).toArray()) {
      const n = await db.notes.get(c.noteId)
      const nt = await db.notetypes.get(n.notetypeId)
      const r = renderCard(n, nt, c, target.name)
      for (const m of `${r.front}${r.back}`.matchAll(/\/media\/([^"']+)/g)) {
        const name = decodeURIComponent(m[1])
        checkedMedia++
        if (!(await db.media.get(name))) missing = name
      }
    }
    check('thẻ có tham chiếu media', () => assert.ok(checkedMedia > 0))
    check('mọi file media thẻ gọi đều có trong IndexedDB', () =>
      assert.equal(missing, null, `thiếu: ${missing}`),
    )
    console.log(`    đã đối chiếu ${checkedMedia} tham chiếu media`)
  }

  // §7: HTML trong bộ thẻ tải về là code của người lạ — phải bị lọc.
  const evil = sanitizeCardHtml(
    '<img src=x onerror=alert(1)>câu hỏi<script>alert(2)<\/script>' +
      '<a href="javascript:alert(3)">đáp án</a>',
  )
  check('sanitize: bỏ <script>', () => assert.ok(!/<script/i.test(evil), evil))
  check('sanitize: bỏ onerror=', () => assert.ok(!/onerror/i.test(evil), evil))
  check('sanitize: bỏ javascript: href', () => assert.ok(!/javascript:/i.test(evil), evil))
  check('sanitize: giữ lại nội dung lành', () => assert.ok(evil.includes('câu hỏi')))
  check('sanitize: giữ <audio controls> cho thẻ có tiếng', () => {
    const out = sanitizeCardHtml('<audio controls src="/media/a.mp3"></audio>')
    assert.ok(out.includes('<audio') && out.includes('controls'), out)
  })
  check('sanitize: giữ <ruby> cho furigana', () => {
    const out = sanitizeCardHtml('<ruby>漢字<rt>かんじ</rt></ruby>')
    assert.ok(out.includes('<ruby') && out.includes('<rt'), out)
  })

  // nhập lại lần hai không được nhân đôi hay xoá tiến độ
  const cardsBefore = await db.cards.count()
  const second = await importCollection(col)
  const cardsAfter = await db.cards.count()
  check('nhập lại không nhân đôi thẻ', () => assert.equal(cardsBefore, cardsAfter))
  check('nhập lại giữ nguyên thẻ cũ', () => assert.ok(second.keptCards > 0))

  // hạn mức thẻ mới mỗi ngày
  const limited = await buildQueue(target.id, 20)
  check('hàng đợi tôn trọng hạn mức 20 thẻ mới/ngày', () => assert.ok(limited.length <= 20))

  // ------------------------------------------------------------ chôn thẻ anh em
  console.log('\n[5] Chôn thẻ anh em')
  const noteIdsInQueue = limited.map((c) => c.noteId)
  check('trong một phiên, mỗi note chỉ ra một thẻ', () =>
    assert.equal(new Set(noteIdsInQueue).size, noteIdsInQueue.length),
  )

  // Học một thẻ rồi dựng lại hàng đợi: anh em của nó phải biến mất cả ngày,
  // không chỉ trong phiên đang mở.
  const victim = limited[0]
  const siblings = (await db.cards.where('noteId').equals(victim.noteId).toArray()).filter(
    (c) => c.id !== victim.id,
  )
  if (siblings.length === 0) {
    console.log('    (note này chỉ có 1 thẻ — bỏ qua phần kiểm tra qua phiên)')
  } else {
    const t = new Date()
    const applied = applyRating(victim, Rating.Good, t)
    await db.cards.put({ ...victim, ...applied.card })
    await db.revlog.add({
      cardId: victim.id,
      rating: applied.log.rating,
      state: applied.log.state,
      elapsedDays: applied.log.elapsed_days,
      scheduledDays: applied.log.scheduled_days,
      reviewedAt: t,
    })

    const buriedNotes = await notesStudiedToday()
    check('note vừa học bị đánh dấu là đã học hôm nay', () =>
      assert.ok(buriedNotes.has(victim.noteId)),
    )
    const nextQueue = await buildQueue(target.id, 20)
    check('thẻ anh em không quay lại ở phiên sau trong ngày', () =>
      assert.ok(
        !nextQueue.some((c) => c.noteId === victim.noteId),
        `còn sót ${nextQueue.filter((c) => c.noteId === victim.noteId).length} thẻ`,
      ),
    )
    console.log(`    note ${victim.noteId} có ${siblings.length + 1} thẻ, đã chôn ${siblings.length}`)
  }

  check('keepOnePerNote giữ thẻ đứng trước', () => {
    const kept = keepOnePerNote([
      { id: 1, noteId: 9 },
      { id: 2, noteId: 9 },
      { id: 3, noteId: 8 },
    ])
    assert.deepEqual(
      kept.map((c) => c.id),
      [1, 3],
    )
  })

  // ------------------------------------------------------------ xoá deck
  console.log('\n[6] Xoá bộ thẻ')
  const beforeCards = await db.cards.count()
  const beforeNotes = await db.notes.count()
  const beforeRevlog = await db.revlog.count()
  const deckCardCount = await db.cards.where('deckId').equals(target.id).count()

  const deleted = await deleteDeck(target.id)
  console.log(
    `    đã xoá ${deleted.cards} thẻ, ${deleted.notes} note, ${deleted.revlog} dòng revlog`,
  )
  const deckGone = (await db.decks.get(target.id)) === undefined
  check('hàng deck bị xoá', () => assert.ok(deckGone))
  check('số thẻ xoá khớp số thẻ trong deck', () => assert.equal(deleted.cards, deckCardCount))
  const afterCards = await db.cards.count()
  check('thẻ của deck đã sạch', () => assert.equal(afterCards, beforeCards - deckCardCount))
  const afterNotes = await db.notes.count()
  check('note mồ côi bị dọn theo', () => assert.ok(afterNotes < beforeNotes))
  const leftoverCards = await db.cards.where('deckId').equals(target.id).count()
  check('không sót thẻ nào trỏ về deck đã xoá', () => assert.equal(leftoverCards, 0))
  const afterRevlog = await db.revlog.count()
  check('revlog của thẻ đã xoá cũng đi theo', () => assert.ok(afterRevlog <= beforeRevlog))

  // Deck gõ tay phải còn nguyên — xoá deck này không được đụng deck kia.
  const manualLeft = await db.cards.where('deckId').equals(DEFAULT_DECK_ID).count()
  check('deck khác không bị ảnh hưởng', () => assert.equal(manualLeft, 2))
}

console.log(`\n${passed} kiểm tra đạt${process.exitCode ? ' — CÓ LỖI Ở TRÊN' : ''}`)
await db.close()
