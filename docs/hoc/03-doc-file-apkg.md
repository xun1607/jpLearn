# 3. Đọc file `.apkg`

Phần khó nhất dự án, và là bài học tốt nhất về **kỹ thuật đảo ngược một định dạng
không có tài liệu chính thức**.

## `.apkg` thực chất là gì

Một file ZIP. Đổi đuôi thành `.zip` là giải nén được. Bên trong:

```
collection.anki21b   ← database SQLite, có thể nén zstd
collection.anki2     ← database SQLite (cẩn thận — xem Bẫy 2)
media                ← file ánh xạ tên
0, 1, 2, 3…          ← file media, đặt tên bằng SỐ
meta
```

Dây chuyền: **ZIP → (zstd) → SQLite → (JSON hoặc protobuf)**. Bốn lớp, mỗi lớp một
thư viện:

| Lớp | Thư viện |
| --- | -------- |
| ZIP | `fflate` |
| zstd | `fzstd` |
| SQLite | `sql.js` (SQLite biên dịch sang WASM) |
| protobuf | tự viết ~60 dòng |

## Bước quan trọng nhất: soi trước khi viết code

Trước khi viết dòng parser nào, chạy đoạn này để liệt kê entry trong 3 file thật:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [System.IO.Compression.ZipFile]::OpenRead($f)
$z.Entries | ForEach-Object { $_.FullName }
```

Kết quả định hình toàn bộ kế hoạch:

```
all-in-one-kanji : collection.anki2                        ← chỉ 1 DB
MIMIKARA         : collection.anki21  + collection.anki2   ← 2 DB
Manh JPN ver4    : collection.anki21b + collection.anki2   ← 2 DB, 1 cái nén
```

> **Cách nghĩ**: với định dạng lạ, việc đầu tiên không phải là viết parser mà là
> **quan sát**. 15 phút soi file tiết kiệm nửa ngày đoán mò.

## Bẫy 1 — hai định dạng schema cùng tồn tại

| | Schema v11 (cũ) | Schema v18 (mới) |
| --- | --- | --- |
| notetype, deck | JSON trong cột `col.models` / `col.decks` | Bảng riêng `notetypes`, `fields`, `templates`, `decks` |
| `qfmt` / `afmt` | JSON, `JSON.parse` là xong | **Protobuf trong cột BLOB** |

Cách phát hiện: nếu `col.models` rỗng thì đó là v18.

```ts
let notetypes = readNotetypesV11(db)
if (notetypes.length === 0) {
  schema = 'v18'
  notetypes = readNotetypesV18(db)
}
```

Chú ý cách viết: **thử v11 trước, rỗng thì mới sang v18**. Không phán đoán bằng
việc "có bảng `notetypes` hay không" — vì file đã từng là v18 rồi bị hạ cấp xuống
v11 vẫn còn dấu vết bảng cũ trong các trang đã giải phóng.

Chính chỗ này suýt dẫn tới kết luận sai: quét chuỗi `CREATE TABLE notetypes` trong
byte thô của `MIMIKARA` thì **thấy có**, tưởng là v18. Chạy thật mới biết
`col.models` dài 4676 ký tự → v11 hẳn hoi.

> **Bài học**: quét byte thô chỉ để *đặt giả thuyết*. Kết luận phải dựa trên truy
> vấn thật.

### Lệch khỏi kế hoạch một cách có tính toán

CLAUDE.md §6 bảo: MVP chỉ hỗ trợ v11, gặp v18 thì bắt người dùng export lại.

Nhưng nhìn kỹ bảng trên: **thứ duy nhất nằm trong protobuf là `qfmt`/`afmt`.** Mà
bản đầu tiên không có template engine → không dùng tới `qfmt`/`afmt`. Mọi thứ còn
lại ở v18 đều là **cột text thường**:

| Cần gì | v11 | v18 |
| ------ | --- | --- |
| Nội dung note | `notes.flds` | y hệt |
| Tên field | JSON | bảng `fields(ntid, ord, name)` |
| Tên deck | JSON | bảng `decks(id, name)` |

→ Thêm ~40 dòng, đổi lại 3/3 bộ thẻ import được ngay.

> **Cách nghĩ**: khi tài liệu bảo "không làm được X", hãy hỏi **"chính xác thì cái
> gì chặn?"**. Rào cản thật thường hẹp hơn nhiều so với lời cảnh báo.

## Bẫy 2 — file mồi

Bản Anki mới nhét vào gói một `collection.anki2` **giả**, schema v11, chứa đúng một
thẻ ghi "hãy cập nhật Anki lên bản mới nhất". Mục đích là để bản Anki cũ mở ra thấy
lời nhắc thay vì lỗi.

Nếu parser đọc `collection.anki2` trước thì **import thành công đúng một thẻ vô
nghĩa** — không có lỗi nào báo ra cả.

Cách chống:

```ts
const DB_ENTRIES = ['collection.anki21b', 'collection.anki21', 'collection.anki2']
const dbEntry = DB_ENTRIES.find((name) => zip[name])
```

Đã kiểm chứng bằng `scripts/compare-dbs.mjs`, đếm note trong *từng* DB của gói:

```
MIMIKARA: collection.anki21  notes=20   ← bản thật
          collection.anki2   notes=1    ← file mồi, đúng như mô tả
```

> **Cách nghĩ**: khi tài liệu cảnh báo một cái bẫy, **hãy tự kiểm chứng nó có thật
> không** thay vì tin suông. Ở đây nó có thật, và nếu không kiểm thì sẽ mất hàng
> giờ tự hỏi "sao bộ thẻ chỉ có 1 thẻ".

## Bẫy 3 — lịch học cũ

Bộ thẻ chia sẻ thường đã bị xoá sạch dữ liệu lịch trình. Mà kể cả còn thì đó là số
liệu SM-2 (`ivl`, `factor`), **không ánh xạ thẳng sang stability/difficulty của
FSRS được** — hai thuật toán mô hình hoá trí nhớ theo cách khác nhau.

Cố chuyển đổi là tự bịa ra dữ liệu. Quyết định: nhập nội dung thôi, mọi thẻ vào ở
trạng thái `new`.

```ts
candidates.push({
  ...createEmptyCard(now),   // luôn luôn là thẻ mới
  id: card.id, noteId: card.noteId, deckId, ord: card.ord, suspended: 0,
})
```

> **Nguyên tắc**: thà không có dữ liệu còn hơn có dữ liệu bịa. Thẻ `new` sẽ được
> hiệu chỉnh đúng sau vài lần ôn; thẻ nhập sai sẽ lệch lịch mãi mãi.

## Bẫy thứ tư, không có trong tài liệu

§6 nói file ánh xạ `media` là JSON:

```json
{"0": "neko.jpg", "1": "kane.mp3"}
```

Soi thật thì ra ba dạng khác nhau:

```
all-in-one-kanji : 7b 7d                 → "{}"          JSON rỗng
MIMIKARA         : 7b 22 33 34 22 3a     → '{"34":"…'    JSON thường
Manh JPN ver4    : 28 b5 2f fd …         → zstd!          bọc protobuf
```

`28 b5 2f fd` là magic number của zstd. Giải nén ra thì không phải JSON mà là
protobuf:

```
0a 76        field 1 (entries), wiretype 2, dài 0x76
   0a 5a     field 1 (name), dài 0x5a = 90 ký tự
      "ElevenLabs_2026-03-29T02_27_41_Sakura…mp3"
   10 …      field 2 (size), varint
   1a 14     field 3 (sha1), dài 20 byte
```

Khớp chính xác với:

```protobuf
message MediaEntries { repeated MediaEntry entries = 1; }
message MediaEntry   { string name = 1; uint32 size = 2; bytes sha1 = 3; }
```

Cách xử lý trong `src/lib/apkg/media.ts`: thử lần lượt JSON → zstd+JSON →
zstd+protobuf, dạng nào cũng không ra thì trả cảnh báo chứ **không làm hỏng cả lần
import**.

```ts
const asJson = tryJson(bytes)
if (asJson) return { map: asJson }
try {
  return { map: parseMediaProtobuf(bytes) }
} catch (err) {
  return { map: new Map(), warning: `Không đọc được danh sách media: ${err}` }
}
```

> **Bài học kép**:
> 1. Tài liệu luôn lạc hậu so với định dạng thật. Kiểm chứng bằng byte thật.
> 2. **Giảm cấp nhẹ nhàng**: media hỏng thì mất âm thanh, chứ đừng mất cả bộ thẻ.

### Viết bộ đọc protobuf tối thiểu

Không cần thư viện. Protobuf là chuỗi cặp `(tag, giá trị)`, tag mã hoá cả số hiệu
field lẫn kiểu dữ liệu:

```ts
const field = tag >>> 3     // số hiệu field
const wire  = tag & 7       // 0=varint, 1=64bit, 2=độ dài, 5=32bit
```

Biết đúng 4 kiểu wire là bỏ qua được mọi field không quan tâm — kể cả field mình
chưa từng thấy. Đó chính là lý do protobuf tương thích ngược tốt.

## Vài chi tiết nhỏ nhưng hay cắn

**Field bị nhồi chung một chuỗi**, ngăn bằng ký tự `\x1f` (Unit Separator):

```ts
fields: str(flds).split('\x1f')
```

**Deck lọc dùng `odid`.** Thẻ đang nằm trong deck lọc thì `did` trỏ deck lọc, deck
thật nằm ở `odid`:

```ts
const original = num(odid)
let deckId = original !== 0 ? original : num(did)
```

**Phân cấp deck khác nhau giữa hai schema**: v11 dùng `::`, v18 dùng `\x1f`. Quy về
một kiểu ngay lúc parse.

**Media lưu theo tên thật, không theo tên số.** Trong zip file tên là `0`, `1`, `2`;
trong thẻ thì viết `<img src="neko.jpg">`. Phải ghép qua bảng ánh xạ rồi lưu theo
tên thật, nếu không thẻ gọi mãi không ra.

## Vì sao phải chạy trong Web Worker

Bộ 7065 thẻ: giải nén ZIP + chạy SQLite WASM + đọc 3787 note. Ở luồng chính thì UI
đơ vài giây — trên iPhone nhìn như app treo.

```ts
const worker = new Worker(new URL('../../workers/importApkg.worker.ts', import.meta.url), {
  type: 'module',
})
```

Nhưng **chỉ parse trong worker, còn ghi Dexie thì để luồng chính làm**. Lý do:
`useLiveQuery` ở luồng chính mới thấy thay đổi ngay. Ghi từ worker thì danh sách
deck không tự cập nhật.

> Chia việc theo *ai cần thấy kết quả*, không chỉ theo *cái gì nặng*.

## Đọc tiếp

- [04 — Render thẻ](04-render-the.md)
- Code: [`src/lib/apkg/parse.ts`](../../src/lib/apkg/parse.ts), [`src/lib/apkg/media.ts`](../../src/lib/apkg/media.ts)
- Công cụ: `npm run inspect -- <file.apkg>`, `node scripts/compare-dbs.mjs <file.apkg>`
