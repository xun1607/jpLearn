/**
 * Test đồng bộ chạy bằng Node + fake-indexeddb, không cần mạng.
 *
 *   npm run test:sync
 *
 * Hai máy được giả lập bằng hai DB Dexie trong cùng một process, server giả
 * lập bằng `memoryRemote` trong bộ nhớ. Nhờ engine chỉ biết interface
 * `SyncRemote` nên đổi Supabase sang bản giả là xong, không phải sửa engine.
 */
import 'fake-indexeddb/auto'
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import Dexie from 'dexie'

const root = path.resolve(import.meta.dirname, '..')

let passed = 0
async function check(label, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${label}`)
  } catch (err) {
    console.log(`  ✗ ${label}\n      ${err.message}`)
    process.exitCode = 1
  }
}

async function loadApp() {
  const outfile = path.join(root, 'node_modules/.cache/apkg/sync.mjs')
  mkdirSync(path.dirname(outfile), { recursive: true })
  await build({
    entryPoints: [path.join(root, 'scripts/sync-entry.ts')],
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
  db,
  FlashcardDB,
  recordReview,
  rebuildCards,
  importCollection,
  replayCard,
  applyRating,
  createEmptyCard,
  State,
  syncOnce,
  dexieStore,
  memoryRemote,
  PULL_OVERLAP,
  PULL_PAGE,
} = app

/** PRNG có seed: test lặp lại được, lỗi hôm nay thì mai chạy vẫn ra đúng lỗi đó. */
function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(20261005)
const pick = (n) => Math.floor(rand() * n)

const DAY = 86_400_000
const T0 = new Date('2026-01-01T08:00:00Z')

function baseCard(id, at = T0) {
  return { ...createEmptyCard(at), id, noteId: id, deckId: 1, ord: 0, suspended: 0 }
}

/**
 * Ôn ngẫu nhiên một thẻ `n` lần. Lần ôn sau rơi quanh ngày tới hạn — có khi
 * sớm, có khi trễ cả tuần — để đi qua đủ nhánh new/learning/review/relearning.
 */
function simulate(card, n) {
  const logs = []
  let t = card.due.getTime()
  for (let i = 0; i < n; i++) {
    const grade = 1 + pick(4)
    const at = new Date(t)
    const { card: next } = applyRating(card, grade, at)
    card = { ...card, ...next }
    logs.push({ uid: `u-${card.id}-${i}`, rating: grade, reviewedAt: at })
    const jitter = (rand() - 0.3) * 7 * DAY
    t = Math.max(t + 60_000, card.due.getTime() + jitter)
  }
  return { card, logs }
}

function shuffled(arr) {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = pick(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ------------------------------------------------------------ 1. phát lại

console.log('\n[1] Phát lại revlog ra đúng trạng thái thẻ')

let totalReviews = 0
let mismatch = null
const sampleStates = new Set()
for (let id = 1; id <= 80; id++) {
  const n = 1 + pick(40)
  totalReviews += n
  const { card: live, logs } = simulate(baseCard(id), n)
  sampleStates.add(live.state)
  // Xáo thứ tự: revlog kéo về từ server không đảm bảo theo thời gian.
  const replayed = replayCard(baseCard(id, new Date(0)), shuffled(logs))
  try {
    assert.deepStrictEqual(replayed, live)
  } catch (err) {
    mismatch ??= `thẻ ${id}: ${err.message.slice(0, 300)}`
  }
}
console.log(`    80 thẻ, ${totalReviews} lần ôn`)

await check('phát lại khớp TỪNG TRƯỜNG với trạng thái ôn trực tiếp', () =>
  assert.equal(mismatch, null, mismatch),
)
await check('dữ liệu thử đi qua nhiều trạng thái thẻ', () =>
  assert.ok(sampleStates.size >= 2, `chỉ gặp state ${[...sampleStates]}`),
)

// Đối chứng âm: test trên phải ĐỎ được. Đổi một lần chấm thì kết quả phải khác.
await check('đổi một lần chấm thì phát lại ra kết quả khác (test không rỗng)', () => {
  const { card: live, logs } = simulate(baseCard(999), 12)
  const tampered = logs.map((l, i) => (i === 5 ? { ...l, rating: l.rating === 1 ? 4 : 1 } : l))
  assert.notDeepStrictEqual(replayCard(baseCard(999), tampered), live)
})

await check('thẻ không có revlog thì về trạng thái New', () => {
  const { card } = simulate(baseCard(5000), 5)
  const reset = replayCard(card, [])
  assert.equal(reset.state, State.New)
  assert.equal(reset.reps, 0)
})

await check('giữ nguyên deck / ord / suspended khi phát lại', () => {
  const base = { ...baseCard(5001), deckId: 42, ord: 1, suspended: 1 }
  const { logs } = simulate(base, 3)
  const out = replayCard(base, logs)
  assert.deepEqual([out.deckId, out.ord, out.suspended], [42, 1, 1])
})

// ------------------------------------------------------------ 2. nâng cấp schema

console.log('\n[2] Nâng cấp Dexie v1 -> v2')

{
  // Dựng đúng DB v1 như máy đang chạy bản cũ, có sẵn lịch sử ôn.
  const old = new Dexie('migrate-me')
  old.version(1).stores({
    notetypes: 'id, name',
    decks: 'id, name',
    notes: 'id, notetypeId, guid, *tags',
    cards: 'id, noteId, deckId, due, [deckId+due], [deckId+state]',
    revlog: '++id, cardId, reviewedAt',
    media: 'name',
    config: 'key',
  })
  await old.open()
  for (let i = 0; i < 25; i++) {
    await old.table('revlog').add({
      cardId: i,
      rating: 3,
      state: 0,
      elapsedDays: 0,
      scheduledDays: 1,
      reviewedAt: new Date(T0.getTime() + i * 1000),
    })
  }
  old.close()

  const upgraded = new FlashcardDB('migrate-me')
  const rows = await upgraded.revlog.toArray()
  await check('không mất dòng revlog nào', () => assert.equal(rows.length, 25))
  await check('dòng cũ được cấp uid, không trùng', () => {
    assert.ok(rows.every((r) => typeof r.uid === 'string' && r.uid.length > 0))
    assert.equal(new Set(rows.map((r) => r.uid)).size, 25)
  })
  await check('dòng cũ đánh dấu chưa đồng bộ', async () =>
    assert.equal(await upgraded.revlog.where('synced').equals(0).count(), 25),
  )
  await check('uid là index duy nhất', async () => {
    await assert.rejects(upgraded.revlog.add({ ...rows[0], id: undefined }))
  })
  upgraded.close()
}

// ------------------------------------------------------------ 3. ghi + dựng lại

console.log('\n[3] recordReview và rebuildCards')

{
  const dev = new FlashcardDB('device-solo')
  await dev.cards.put(baseCard(7))
  let t = T0.getTime()
  for (const grade of [3, 1, 3, 3, 4]) {
    const card = await recordReview(7, grade, new Date(t), dev)
    t = card.due.getTime() + DAY
  }
  const stored = await dev.cards.get(7)
  const logs = await dev.revlog.where('cardId').equals(7).toArray()

  await check('5 lần ôn -> 5 dòng revlog chờ đồng bộ', () => {
    assert.equal(logs.length, 5)
    assert.ok(logs.every((l) => l.synced === 0 && l.uid))
  })
  await check('revlog ghi state TRƯỚC khi ôn', () => assert.equal(logs[0].state, State.New))

  await dev.cards.put(baseCard(7)) // xoá trạng thái, chỉ còn revlog
  await rebuildCards([7], dev)
  await check('dựng lại từ revlog ra đúng thẻ đã lưu', async () =>
    assert.deepStrictEqual(await dev.cards.get(7), stored),
  )
  dev.close()
}

// ------------------------------------------------------------ 4. revlog tới trước bộ thẻ

console.log('\n[4] Revlog tới trước, nhập bộ thẻ sau')

{
  // Máy B đã kéo revlog của thẻ 777 về, nhưng chưa nhập bộ thẻ chứa nó.
  const { card: expected, logs } = simulate(baseCard(777), 6)
  await db.revlog.bulkAdd(
    logs.map((l) => ({
      ...l,
      synced: 1,
      cardId: 777,
      state: 0,
      elapsedDays: 0,
      scheduledDays: 0,
    })),
  )

  const summary = await importCollection({
    schema: 'v11',
    dbEntry: 'collection.anki2',
    notetypes: [
      {
        id: 1_700_000_000_001,
        name: 'Thử',
        fields: ['Trước', 'Sau'],
        css: '',
        templates: [{ name: 'T', qfmt: '{{Trước}}', afmt: '{{Sau}}' }],
      },
    ],
    decks: [{ id: 1_700_000_000_002, name: 'Bộ đồng bộ' }],
    notes: [
      { id: 777, guid: 'g777', notetypeId: 1_700_000_000_001, fields: ['a', 'b'], tags: [] },
      { id: 778, guid: 'g778', notetypeId: 1_700_000_000_001, fields: ['c', 'd'], tags: [] },
    ],
    cards: [
      { id: 777, noteId: 777, deckId: 1_700_000_000_002, ord: 0 },
      { id: 778, noteId: 778, deckId: 1_700_000_000_002, ord: 0 },
    ],
    media: [],
    warnings: [],
  })

  const restored = await db.cards.get(777)
  await check('thẻ có revlog sẵn được khôi phục tiến độ ngay khi nhập', () => {
    assert.equal(restored.reps, expected.reps)
    assert.equal(restored.state, expected.state)
    assert.equal(restored.due.getTime(), expected.due.getTime())
    assert.equal(restored.stability, expected.stability)
  })
  await check('thẻ chưa từng ôn vẫn là New', async () =>
    assert.equal((await db.cards.get(778)).state, State.New),
  )
  await check('báo cho người dùng biết đã khôi phục', () =>
    assert.ok(summary.warnings.some((w) => w.includes('khôi phục')), summary.warnings.join(' | ')),
  )
}

// ------------------------------------------------------------ 5. hai máy

console.log('\n[5] Hai máy, một server')

{
  const remote = memoryRemote()
  const A = new FlashcardDB('device-a')
  const B = new FlashcardDB('device-b')
  const storeA = dexieStore(A, 'me')
  const storeB = dexieStore(B, 'me')
  const sync = (store) => syncOnce(store, remote)

  // Cùng một bộ thẻ trên cả hai máy — như nhập cùng một .apkg.
  const deck = Array.from({ length: 30 }, (_, i) => baseCard(1000 + i))
  await A.cards.bulkPut(deck)
  await B.cards.bulkPut(deck)

  const cardsOf = (dev) => dev.cards.orderBy('id').toArray()
  const sameCards = async () => assert.deepStrictEqual(await cardsOf(A), await cardsOf(B))

  let clock = T0.getTime()
  const tick = (ms = 90_000) => new Date((clock += ms))

  // iPhone học 10 thẻ.
  for (let i = 0; i < 10; i++) await recordReview(1000 + i, 1 + pick(4), tick(), A)
  const r1 = await sync(storeA)
  await check('iPhone đẩy 10 lần ôn lên', () => {
    assert.equal(r1.pushed, 10)
    assert.equal(remote.rows.length, 10)
  })
  await check('iPhone không còn gì chờ đẩy', async () =>
    assert.equal(await A.revlog.where('synced').equals(0).count(), 0),
  )

  const r2 = await sync(storeB)
  await check('iPad kéo về 10 dòng, dựng lại 10 thẻ', () => {
    assert.equal(r2.pulled, 10)
    assert.equal(r2.rebuilt, 10)
  })
  await check('iPad có ĐÚNG trạng thái thẻ như iPhone', sameCards)

  // iPad học tiếp, có cả thẻ iPhone đã học.
  for (let i = 5; i < 15; i++) await recordReview(1000 + i, 1 + pick(4), tick(DAY * 2), B)
  await sync(storeB)
  await sync(storeA)
  await check('học tiếp trên iPad -> iPhone thấy', sameCards)

  // Cả hai offline, cùng ôn MỘT thẻ, rồi mới đồng bộ.
  const before = (await A.cards.get(1020)).reps
  await recordReview(1020, 3, tick(DAY), A)
  await recordReview(1020, 1, tick(3_600_000), B)
  await recordReview(1021, 4, tick(), B)
  await sync(storeA)
  await sync(storeB)
  await sync(storeA)
  await check('ôn cùng một thẻ lúc offline: hai máy hội tụ', sameCards)
  await check('không lần ôn nào bị mất khi gộp', async () =>
    assert.equal((await A.cards.get(1020)).reps, before + 2),
  )
  await check('kết quả gộp = phát lại toàn bộ revlog', async () => {
    const logs = await A.revlog.where('cardId').equals(1020).toArray()
    assert.deepStrictEqual(await A.cards.get(1020), replayCard(baseCard(1020), logs))
  })

  const idle = await sync(storeA)
  await check('đồng bộ lần nữa khi không có gì mới: không đẩy, không kéo', () =>
    assert.deepEqual(idle, { pushed: 0, pulled: 0, rebuilt: 0 }),
  )

  // Mất mạng giữa chừng.
  for (let i = 0; i < 3; i++) await recordReview(1025 + i, 3, tick(), A)
  const rowsBefore = remote.rows.length
  remote.failNext = 1
  await check('mất mạng: sync báo lỗi chứ không nuốt im', () => assert.rejects(sync(storeA)))
  await check('mất mạng: 3 lần ôn vẫn nằm chờ trên máy', async () =>
    assert.equal(await A.revlog.where('synced').equals(0).count(), 3),
  )
  await sync(storeA)
  await check('có mạng lại: đẩy đủ 3 dòng', () => assert.equal(remote.rows.length, rowsBefore + 3))

  // Server đã nhận nhưng máy chưa kịp đánh dấu synced (app bị tắt đúng lúc đó).
  await recordReview(1028, 3, tick(), A)
  await remote.pushRevlog(await storeA.pendingRevlog(10))
  const countAfterFirst = remote.rows.length
  await sync(storeA)
  await check('đẩy lại dòng server đã có thì không sinh bản trùng', () =>
    assert.equal(remote.rows.length, countAfterFirst),
  )

  await sync(storeB)
  await check('sau mọi sự cố, hai máy vẫn khớp', sameCards)

  // Dòng commit muộn: mang seq nhỏ hơn con trỏ iPad đã đi qua.
  const cursorB = await storeB.getCursor()
  remote.insertLate(
    {
      uid: 'late-1',
      cardId: 1029,
      rating: 3,
      state: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reviewedAt: tick(),
    },
    cursorB - 5,
  )
  await sync(storeB)
  await check(`dòng commit muộn (seq lùi < ${PULL_OVERLAP}) vẫn được vớt`, async () =>
    assert.equal((await B.cards.get(1029)).reps, 1),
  )
  await check('con trỏ không bị kéo lùi', async () =>
    assert.ok((await storeB.getCursor()) >= cursorB),
  )
  await check('con trỏ tách theo tài khoản', async () =>
    assert.equal(await dexieStore(B, 'người-khác').getCursor(), 0),
  )

  // Nhiều hơn một trang kéo về.
  const bulkCards = Array.from({ length: 300 }, (_, i) => baseCard(5000 + i))
  await A.cards.bulkPut(bulkCards)
  await B.cards.bulkPut(bulkCards)
  const many = PULL_PAGE * 2 + 137
  for (let i = 0; i < many; i++) await recordReview(5000 + (i % 300), 1 + pick(4), tick(), A)
  await sync(storeA)
  await sync(storeA) // A kéo lại dòng commit muộn ở trên
  const big = await sync(storeB)
  await check(`kéo ${many} dòng qua nhiều trang`, () => assert.equal(big.pulled, many))
  await check('nhiều trang: hai máy vẫn khớp', sameCards)

  A.close()
  B.close()
}

console.log(`\n${passed} kiểm tra đạt${process.exitCode ? ' — CÓ LỖI Ở TRÊN' : ''}`)
await db.close()
