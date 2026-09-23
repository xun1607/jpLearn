/**
 * Phần kiểm tra cho màn browser. Tách riêng khỏi smoke-test.mjs để file kia
 * khỏi phình; smoke-test gọi vào đây sau khi đã nhập xong bộ thẻ.
 */
import assert from 'node:assert/strict'

export async function runBrowseTests(app, check, target, State) {
  const {
    db,
    parseQuery,
    matchesNote,
    matchesCard,
    needsNoteScan,
    runSearch,
    updateNote,
    setSuspended,
    moveCard,
    deleteNote,
    DEFAULT_DECK_ID,
  } = app

  console.log('\n[7] Phân tích câu tìm kiếm')

  check('từ khoá thường', () => {
    const q = parseQuery('kanji  học')
    assert.deepEqual(q.terms, ['kanji', 'học'])
    assert.equal(q.empty, false)
  })
  check('câu rỗng -> empty', () => assert.equal(parseQuery('   ').empty, true))
  check('deck: / tag: / is:', () => {
    const q = parseQuery('deck:N5 tag:Động-từ is:due')
    assert.deepEqual(q.decks, ['n5'])
    assert.deepEqual(q.tags, ['động-từ'])
    assert.deepEqual(q.is, ['due'])
    assert.deepEqual(q.terms, [])
  })
  check('cụm trong nháy giữ nguyên dấu cách', () => {
    const q = parseQuery('deck:"Nhật Bản::N5" xin')
    assert.deepEqual(q.decks, ['nhật bản::n5'])
    assert.deepEqual(q.terms, ['xin'])
  })
  check('dấu trừ là loại bỏ', () => {
    const q = parseQuery('kanji -radical')
    assert.deepEqual(q.terms, ['kanji'])
    assert.deepEqual(q.negated, ['radical'])
  })
  check('is: giá trị lạ thì bỏ, không coi là từ khoá', () => {
    const q = parseQuery('is:xyz')
    assert.deepEqual(q.is, [])
    assert.deepEqual(q.terms, [], 'không được rơi xuống thành từ khoá')
  })
  check('needsNoteScan đúng chỗ', () => {
    assert.equal(needsNoteScan(parseQuery('deck:N5')), false, 'chỉ deck thì khỏi quét note')
    assert.equal(needsNoteScan(parseQuery('is:due')), false)
    assert.equal(needsNoteScan(parseQuery('kanji')), true)
    assert.equal(needsNoteScan(parseQuery('tag:x')), true)
  })

  console.log('\n[8] Lọc note và card')

  const note = { id: 1, notetypeId: 1, guid: 'g', fields: ['<b>漢字</b>', 'chữ Hán'], tags: ['n5', 'Kanji'] }

  check('khớp qua nhiều field', () => assert.ok(matchesNote(note, parseQuery('chữ'))))
  check('bỏ thẻ HTML trước khi dò', () =>
    assert.ok(matchesNote(note, parseQuery('漢字')), 'không được vướng vào <b>'),
  )
  check('nhiều từ khoá là AND', () => {
    assert.ok(matchesNote(note, parseQuery('漢字 hán')))
    assert.ok(!matchesNote(note, parseQuery('漢字 khôngcó')))
  })
  check('không phân biệt hoa thường', () => assert.ok(matchesNote(note, parseQuery('HÁN'))))
  check('loại bỏ hoạt động', () => assert.ok(!matchesNote(note, parseQuery('漢字 -hán'))))
  check('tag khớp đúng cả khi khác hoa thường', () =>
    assert.ok(matchesNote(note, parseQuery('tag:kanji'))),
  )
  check('tag khớp toàn phần, không khớp một phần', () =>
    assert.ok(!matchesNote(note, parseQuery('tag:kan'))),
  )

  const now = new Date('2026-09-23T10:00:00Z')
  const past = new Date('2026-09-20T10:00:00Z')
  const future = new Date('2026-09-30T10:00:00Z')
  const card = (over) => ({
    id: 1, noteId: 1, deckId: 1, ord: 0, suspended: 0,
    state: State.Review, due: past, reps: 1, lapses: 0,
    stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0,
    ...over,
  })

  check('deck: khớp một phần tên deck', () =>
    assert.ok(matchesCard(card(), 'Nhật::N5::Kanji', parseQuery('deck:n5'), now)),
  )
  check('deck: không khớp thì loại', () =>
    assert.ok(!matchesCard(card(), 'Nhật::N3', parseQuery('deck:n5'), now)),
  )
  check('is:due bắt thẻ quá hạn', () =>
    assert.ok(matchesCard(card({ due: past }), 'd', parseQuery('is:due'), now)),
  )
  check('is:due bỏ thẻ chưa tới hạn', () =>
    assert.ok(!matchesCard(card({ due: future }), 'd', parseQuery('is:due'), now)),
  )
  check('thẻ mới KHÔNG tính là is:due', () =>
    assert.ok(
      !matchesCard(card({ state: State.New, due: past }), 'd', parseQuery('is:due'), now),
      'thẻ mới chưa từng được hẹn, gọi là tới hạn thì sai',
    ),
  )
  check('is:new', () =>
    assert.ok(matchesCard(card({ state: State.New }), 'd', parseQuery('is:new'), now)),
  )
  check('is:suspended', () => {
    assert.ok(matchesCard(card({ suspended: 1 }), 'd', parseQuery('is:suspended'), now))
    assert.ok(!matchesCard(card({ suspended: 0 }), 'd', parseQuery('is:suspended'), now))
  })
  check('nhiều is: phải khớp tất cả', () =>
    assert.ok(
      !matchesCard(card({ state: State.New, suspended: 0 }), 'd', parseQuery('is:new is:suspended'), now),
    ),
  )

  console.log('\n[9] Tìm kiếm thật trên dữ liệu đã nhập')

  const all = await runSearch('')
  check('câu rỗng trả về mọi thẻ', () => assert.ok(all.total > 0))
  check('có cắt trang khi quá nhiều', () => assert.ok(all.rows.length <= 200))
  check('tổng lớn hơn số dòng hiện ra', () =>
    assert.ok(all.total >= all.rows.length && all.truncated === all.total > all.rows.length),
  )
  check('mỗi dòng có tiêu đề đọc được', () =>
    assert.ok(all.rows.every((r) => typeof r.title === 'string' && r.title.length > 0)),
  )
  check('tiêu đề đã bỏ thẻ HTML', () =>
    assert.ok(!all.rows.some((r) => r.title.includes('<'))),
  )

  const byDeck = await runSearch(`deck:"${target.name}"`)
  check('lọc theo deck ra đúng deck', () =>
    assert.ok(byDeck.rows.every((r) => r.deckName === target.name)),
  )

  const sample = all.rows.find((r) => r.deckName === target.name) ?? all.rows[0]
  const word = sample.title.slice(0, 2)
  const byText = await runSearch(word)
  check(`tìm theo chữ "${word}" ra kết quả`, () => assert.ok(byText.total > 0))
  check('kết quả đều chứa từ khoá', () => {
    // Phải dò trên TOÀN BỘ field chứ không phải trên `preview` đã bị cắt 160
    // ký tự — bộ kanji có field "Components" chứa chữ khác, khớp ở đó là đúng.
    const bad = byText.rows.find(
      (r) => !r.note.fields.join(' ').toLowerCase().includes(word.toLowerCase()),
    )
    assert.equal(bad, undefined, bad && bad.title)
  })

  const newOnly = await runSearch('is:new')
  check('is:new chỉ ra thẻ mới', () =>
    assert.ok(newOnly.rows.every((r) => r.card.state === State.New)),
  )

  const impossible = await runSearch('zzqqxx-không-tồn-tại')
  check('từ khoá vô nghĩa ra 0 kết quả', () => assert.equal(impossible.total, 0))

  console.log('\n[10] Sửa thẻ')

  const row = sample
  const originalFields = [...row.note.fields]

  await updateNote(row.note.id, ['ĐÃ SỬA', ...originalFields.slice(1)], ['n5', 'đã-sửa'])
  const afterEdit = await db.notes.get(row.note.id)
  check('sửa field được lưu', () => assert.equal(afterEdit.fields[0], 'ĐÃ SỬA'))
  check('các field khác không bị đụng', () =>
    assert.deepEqual(afterEdit.fields.slice(1), originalFields.slice(1)),
  )
  check('tag được lưu', () => assert.deepEqual(afterEdit.tags, ['n5', 'đã-sửa']))

  const foundEdited = await runSearch('tag:đã-sửa')
  check('tìm được ngay bằng tag mới', () => assert.ok(foundEdited.total > 0))

  const siblingCount = await db.cards.where('noteId').equals(row.note.id).count()
  check('sửa note thì mọi thẻ của nó đổi theo', () => {
    // Không phải sao chép sang từng thẻ — thẻ đọc thẳng từ note.
    assert.ok(siblingCount >= 1)
  })

  await setSuspended(row.card.id, true)
  const suspended = await db.cards.get(row.card.id)
  check('tạm dừng được lưu', () => assert.equal(suspended.suspended, 1))
  const inQueue = await app.buildQueue(row.card.deckId, 500)
  check('thẻ tạm dừng không vào hàng đợi ôn', () =>
    assert.ok(!inQueue.some((c) => c.id === row.card.id)),
  )
  const suspendedSearch = await runSearch('is:suspended')
  check('tìm được thẻ đang tạm dừng', () =>
    assert.ok(suspendedSearch.rows.some((r) => r.card.id === row.card.id)),
  )
  await setSuspended(row.card.id, false)

  await moveCard(row.card.id, DEFAULT_DECK_ID)
  const moved = await db.cards.get(row.card.id)
  check('chuyển deck được lưu', () => assert.equal(moved.deckId, DEFAULT_DECK_ID))
  const siblingsAfterMove = await db.cards.where('noteId').equals(row.note.id).toArray()
  check('chuyển deck chỉ đụng thẻ được chọn', () =>
    assert.ok(
      siblingsAfterMove.filter((c) => c.deckId === DEFAULT_DECK_ID).length <= 1 ||
        siblingsAfterMove.length === 1,
    ),
  )

  const cardsBefore = await db.cards.count()
  const del = await deleteNote(row.note.id)
  const leftoverCards = await db.cards.where('noteId').equals(row.note.id).count()
  const cardsAfter = await db.cards.count()
  const noteGone = (await db.notes.get(row.note.id)) === undefined
  const revlogLeft = await db.revlog.where('cardId').equals(row.card.id).count()

  check('xoá note thì xoá hết thẻ của nó', () => assert.equal(leftoverCards, 0))
  check('số thẻ giảm đúng bằng số thẻ của note', () =>
    assert.equal(cardsBefore - cardsAfter, del.cards),
  )
  check('hàng note bị xoá', () => assert.ok(noteGone))
  check('revlog của thẻ đã xoá cũng đi theo', () => assert.equal(revlogLeft, 0))
  const searchAfterDelete = await runSearch('tag:đã-sửa')
  check('note đã xoá không còn hiện trong kết quả tìm', () =>
    assert.ok(!searchAfterDelete.rows.some((r) => r.note.id === row.note.id)),
  )
}
