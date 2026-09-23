# 2. Thuật toán lặp lại

## Vì sao không tự viết thuật toán

Cám dỗ đầu tiên của mọi người khi làm app flashcard: nghĩ ra hệ "level".

```
Level 1 → 1 ngày
Level 2 → 3 ngày
Level 3 → 7 ngày
Level 4 → 14 ngày
Level 5 → 30 ngày
```

Đúng 1 tiếng là code xong. Và nó sai ở chỗ căn bản: **độ nhớ là đại lượng liên tục,
không phải 5 bậc.** Một từ bạn nhớ 80% và một từ bạn nhớ 95% cùng rơi vào "level 3",
nhưng chúng cần lịch ôn khác hẳn nhau.

FSRS thay 1 số nguyên rời rạc bằng **3 số thực**:

| Đại lượng | Ý nghĩa |
| --------- | ------- |
| **Stability** | Bao lâu nữa thì xác suất nhớ tụt xuống 90% |
| **Difficulty** | Thẻ này vốn khó tới mức nào với riêng bạn |
| **Retrievability** | Ngay lúc này, xác suất bạn nhớ được là bao nhiêu |

Ba số này liên tục nên chính xác hơn hệ level rời rạc, và quan trọng hơn: chúng
được hiệu chỉnh từ dữ liệu ôn thật của hàng triệu người chứ không phải từ cảm tính.

> **Quy tắc**: thuật toán nào đã có người nghiên cứu hàng chục năm thì đừng tự viết.
> Dùng `ts-fsrs`. Công sức của bạn nên đổ vào phần *chỉ bạn mới làm được* — ở đây
> là parser `.apkg` và giao diện.

## API chỉ có hai hàm cần nhớ

```ts
const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: true })

scheduler.repeat(card, new Date())            // xem trước CẢ 4 lựa chọn
scheduler.next(card, new Date(), Rating.Good) // áp dụng 1 lựa chọn
```

`repeat()` dùng để **hiện khoảng thời gian dưới mỗi nút**:

```
 Lại        Khó        Được       Dễ
 1 phút     6 ngày     11 ngày    24 ngày
```

Chi tiết nhỏ nhưng đổi hẳn trải nghiệm: bấm nút từ chỗ *cảm tính* thành chỗ *có
thông tin*. Bạn thấy "Khó = 6 ngày" và tự hỏi "mình có chắc 6 ngày nữa vẫn nhớ
không?" — đó mới là câu hỏi đúng.

`enable_fuzz: true` rải ngẫu nhiên ngày đến hạn quanh giá trị lý thuyết. Không có
nó thì học 50 thẻ hôm nay sẽ tạo ra một cục 50 thẻ cùng đến hạn vào đúng một ngày.

## Một quyết định thiết kế nhỏ nhưng trả cổ tức lớn

Kiểu dữ liệu thẻ **nhúng thẳng** `Card` của ts-fsrs:

```ts
export interface CardRow extends FsrsCard {
  id: number
  noteId: number
  deckId: number
  ord: number
  suspended: 0 | 1
}
```

Nhờ vậy `scheduler.next(row, now, grade)` nhận được row **nguyên vẹn**, không cần
lớp map qua lại:

```ts
const { card: next, log } = applyRating(card, grade, now)
const updated: CardRow = { ...card, ...next }   // gộp lại là xong
```

Nếu tự định nghĩa `{ stability, difficulty, dueDate }` riêng thì mỗi lần gọi phải
dịch xuôi rồi dịch ngược — và mỗi lần dịch là một cơ hội để sót field.

> Đây là biến thể của bài học ở [bài 01](01-tu-y-tuong-den-kien-truc.md): **bám
> hình dạng dữ liệu của thư viện bạn đang dùng.**

## Ba cái bẫy khi làm hàng đợi ôn

Thuật toán chỉ là một nửa. Nửa còn lại là **chọn thẻ nào để hỏi**, và chỗ này mới
lắm bẫy.

### Bẫy 1 — thẻ bấm "Lại" không quay lại

Bấm *Lại* thì FSRS hẹn 1 phút sau. Nếu hàng đợi chỉ dựng một lần lúc vào màn ôn,
thẻ đó biến mất tới ngày hôm sau — đúng thẻ bạn vừa quên lại là thẻ không được ôn.

Cách xử lý trong `ReviewScreen.tsx`:

```ts
const rest = q.slice(1)
if (updated.due.getTime() - now.getTime() < RELEARN_WINDOW_MS) {
  rest.push(updated)     // đẩy lại cuối hàng đợi
}
```

Thẻ nào hẹn dưới 20 phút thì quay lại **trong cùng phiên**.

### Bẫy 2 — đếm hạn mức thẻ mới bằng bộ đếm riêng

Cần giới hạn 20 thẻ mới mỗi ngày. Cách ngây thơ: thêm một biến đếm, reset lúc nửa đêm.

Vấn đề: reset lúc nào? Máy tắt qua đêm thì sao? Đổi múi giờ thì sao? Nhập lại dữ
liệu thì bộ đếm có đi theo không?

Cách trong `queue.ts` — **suy ra từ revlog**:

```ts
export async function newIntroducedToday(): Promise<number> {
  const logs = await db.revlog.where('reviewedAt').aboveOrEqual(startOfToday()).toArray()
  const seen = new Set<number>()
  for (const log of logs) {
    if (log.state === State.New) seen.add(log.cardId)   // state TRƯỚC khi ôn
  }
  return seen.size
}
```

Mẹo ở đây: `revlog.state` là trạng thái **trước** khi ôn. Nên `state === New` nghĩa
là thẻ đó lần đầu ra mắt. Không cần bộ đếm, không cần reset, không lệch khi đổi múi giờ.

> **Nguyên tắc chung**: cái gì suy ra được từ dữ liệu đã có thì đừng lưu thêm.
> Mỗi trạng thái lưu song song là một chỗ có thể lệch nhau.

### Bẫy 3 — thẻ anh em hiện liền nhau

Đây là lỗi phát hiện khi dùng thật, và nó **lặng lẽ phá thuật toán** chứ không làm
app hỏng.

Một note sinh 2 thẻ:

```
Thẻ ord 0:  漢字  →  "chữ Hán"
Thẻ ord 1:  "chữ Hán"  →  漢字
```

Học thẻ đầu xong, thẻ thứ hai hỏi ngay từ đó. Đáp án **còn nguyên trong bộ nhớ
ngắn hạn** → bạn bấm "Dễ" → FSRS ghi nhận stability cao. Nhưng đó là **độ nhớ giả**:
bạn không nhớ từ đó, bạn chỉ vừa nhìn thấy nó 5 giây trước.

Thuật toán không hề báo lỗi. Nó chỉ âm thầm học sai về bạn.

Anki gọi cách xử lý là *bury sibling* — hoãn thẻ anh em sang hôm sau. Cách cài ở đây:

```ts
export async function notesStudiedToday(): Promise<Set<number>> {
  return new Set((await cardsStudiedToday()).map((c) => c.noteId))
}
```

Lại **suy từ revlog**, không thêm cột `buriedUntil` vào schema. Hai cái lợi:

- Chôn còn hiệu lực sau khi đóng app mở lại trong ngày (nếu chỉ lọc trong bộ nhớ
  thì mở lại là thẻ anh em quay về).
- Không phải nâng cấp schema Dexie, không phải viết migration.

Trong phiên đang mở thì lọc thẳng khỏi hàng đợi:

```ts
const rest = q.slice(1).filter((c) => c.noteId !== card.noteId)
```

### Bẫy 3b — lọc sau khi đã cắt hạn mức

Phiên bản đầu của `pickNewCards` lấy một phát rồi lọc:

```ts
// SAI
const pool = await db.cards.where(…).limit(remaining * 4).toArray()
return keepOnePerNote(pool.filter(chưa bị chôn)).slice(0, remaining)
```

Notetype có 10 template thì 80 thẻ lấy về có thể chỉ thuộc 8 note. Lọc xong còn 8
thẻ trong khi hạn mức là 20 → **học hụt mà không biết vì sao**.

Sửa: quét theo trang cho tới khi đủ số note khác nhau.

```ts
while (picked.length < wanted) {
  const page = await db.cards.where(…).offset(offset).limit(PAGE).toArray()
  if (page.length === 0) break
  offset += page.length
  for (const card of page) {
    if (card.suspended || claimed.has(card.noteId)) continue
    claimed.add(card.noteId)
    picked.push(card)
    if (picked.length >= wanted) break
  }
}
```

> **Bài học tổng quát**: khi có *lọc* và có *hạn mức*, luôn hỏi "lọc trước hay cắt
> trước?". Cắt trước rồi lọc là sai gần như mọi lúc.

## Thứ tự ưu tiên trong hàng đợi

```ts
// Thẻ tới hạn giành chỗ trước thẻ mới: ôn cái đã quên
// quan trọng hơn học cái mới.
for (const card of due) claimed.add(card.noteId)
```

Lý do: một thẻ tới hạn là thẻ **sắp rơi khỏi trí nhớ**. Bỏ lỡ nó thì công học trước
đó mất trắng. Còn thẻ mới thì hôm nay không học, mai học vẫn thế.

## Đọc tiếp

- [03 — Đọc file `.apkg`](03-doc-file-apkg.md)
- Code: [`src/scheduler/index.ts`](../../src/scheduler/index.ts), [`src/features/review/queue.ts`](../../src/features/review/queue.ts)
