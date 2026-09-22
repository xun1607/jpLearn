# Flashcard PWA (Anki clone, dùng cá nhân)

Đọc file này trước khi làm bất cứ việc gì. Các quyết định dưới đây đã được cân nhắc,
không tự ý thay đổi — nếu thấy cần đổi thì hỏi trước.

---

## 1. Bối cảnh

App flashcard spaced repetition, chạy trên iPhone và iPad, **chỉ một người dùng** (tác giả).

Lý do chọn PWA thay vì native iOS:

- Không có máy Mac, không có tài khoản Apple Developer.
- App tự build bằng Apple ID free sẽ hết hạn sau 7 ngày, phải cắm máy build lại.
- PWA cài qua Safari → Add to Home Screen: không hết hạn, không cần Xcode, deploy free.

Ba tính năng bắt buộc phải có (đây là lý do tồn tại của dự án):

1. Lặp lại ngắt quãng đúng chuẩn Anki, không phải kiểu đúng/sai của Quizlet.
2. Tuỳ biến được hình thức thẻ (template + CSS).
3. **Import được bộ thẻ `.apkg` chia sẻ từ cộng đồng Anki.**

Nếu phải hy sinh thứ gì thì hy sinh theo thứ tự ngược lại: 3 quan trọng nhất.

---

## 2. Stack (đã chốt)

| Thành phần    | Chọn                             |
| ------------- | -------------------------------- |
| Build         | Vite + React + TypeScript        |
| Lưu trữ       | Dexie.js (bọc IndexedDB)         |
| Thuật toán    | `ts-fsrs` (FSRS v6)              |
| Giải nén ZIP  | `fflate`                         |
| Giải nén zstd | `fzstd`                          |
| Đọc SQLite    | `sql.js` (SQLite biên dịch WASM) |
| Sanitize HTML | `dompurify`                      |
| PWA           | `vite-plugin-pwa`                |
| CSS           | Tailwind                         |

Không dùng: backend bắt buộc, ORM nặng, state library (Dexie live query là đủ).

---

## 3. Nguyên tắc kiến trúc

```
Giao diện (React)
├── Scheduler (ts-fsrs)        ── Render thẻ (template + CSS Anki)
├── Dexie / IndexedDB          ── Import worker (.apkg)
└── Service Worker: offline shell + phục vụ media từ IndexedDB
```

- Mọi thứ chạy trong trình duyệt. Không có server bắt buộc.
- Import `.apkg` **phải chạy trong Web Worker**. Bộ thẻ 20k thẻ sẽ đóng băng UI vài
  giây nếu chạy ở luồng chính.
- Logic scheduler và parser là pure function, không đụng DOM, để test bằng Node được.

---

## 4. Data model

Bám sát schema của Anki. Đây là quyết định quan trọng nhất của dự án: nếu tự nghĩ ra
schema riêng thì phần import sẽ thành cơn ác mộng chuyển đổi.

```ts
notetypes  { id, name, fields: string[], css, templates: [{ name, qfmt, afmt }] }
decks      { id, name }            // "Nhật::N3::Kanji" — "::" là phân cấp
notes      { id, notetypeId, guid, fields: string[], tags: string[] }
cards      { id, noteId, deckId, ord, state, due, suspended,
             stability, difficulty, reps, lapses }
revlog     { id, cardId, rating, state, elapsedDays, reviewedAt }
media      { name, blob }
config     { key, value }
```

**Note và card là hai thứ khác nhau.** Một note (một từ vựng) sinh ra nhiều card qua
nhiều template — ví dụ "Nhận biết" (Nhật→Việt) và "Gợi nhớ" (Việt→Nhật) từ cùng một
note. Trường `ord` trên card trỏ tới index template trong notetype. **Không được rút
gọn thành một bảng cards phẳng.**

Index Dexie cần cho màn ôn: `[deckId+due]`, `[deckId+state]`, `noteId`.

---

## 5. Thuật toán lặp lại

Dùng `ts-fsrs`, **không tự viết SM-2, không làm hệ thống "level" 5 bậc**.

- 4 nút đánh giá: Again (1), Hard (2), Good (3), Easy (4).
- 4 trạng thái thẻ: `new` → `learning` → `review` → `relearning`.
- Mỗi thẻ giữ 3 số thực: Stability, Difficulty, Retrievability. Đây là thứ thay thế
  khái niệm "level" — nó liên tục nên chính xác hơn hệ level rời rạc.

API:

```ts
import { createEmptyCard, fsrs, Rating } from "ts-fsrs";

const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: true });
const preview = scheduler.repeat(card, new Date()); // xem trước cả 4 lựa chọn
const result = scheduler.next(card, new Date(), Rating.Good); // áp dụng 1 lựa chọn
```

Dùng `repeat()` để hiện khoảng thời gian dưới mỗi nút, `next()` khi người dùng đã bấm.
`ts-fsrs` yêu cầu Node >= 20.

---

## 6. Import `.apkg` — phần khó nhất, đọc kỹ

`.apkg` chỉ là một file ZIP. Bên trong có một database SQLite, một file ánh xạ media,
các file media đặt tên bằng số (`0`, `1`, `2`...), và một file metadata.

Quy trình:

1. Giải nén ZIP bằng `fflate`.
2. Tìm database, **thử theo đúng thứ tự**: `collection.anki21b` → `collection.anki21`
   → `collection.anki2`.
3. Nếu là `.anki21b` thì giải nén zstd (`fzstd`) trước khi đưa vào `sql.js`.
4. Đọc bảng `notes`. Các field bị nhồi chung vào một chuỗi, ngăn cách bằng ký tự
   `\x1f` (Unit Separator) — tách bằng `flds.split('\x1f')`.
5. Đọc bảng `cards`, ghép với deck và template qua `nid` / `did` / `ord`.
6. Media: đọc file ánh xạ `{"0": "neko.jpg", "1": "kane.mp3"}`, lưu từng blob vào
   IndexedDB theo **tên thật**, không theo tên số.

### Ba cái bẫy

**Bẫy 1 — hai định dạng schema.**
Bản export cũ dùng schema v11: `models` và `decks` nằm ngay trong cột JSON của bảng
`col`, `JSON.parse` là xong. Bản export mới dùng schema v18: cấu hình lưu dưới dạng
Protobuf trong cột BLOB, và các bảng riêng `notetypes` / `decks` / `templates` thay
cho JSON cũ. Muốn lấy `qfmt`/`afmt` ở v18 phải tự giải mã protobuf.

→ **MVP chỉ hỗ trợ schema v11.** Gặp v18 thì báo người dùng export lại với tuỳ chọn
"Support older Anki versions". Làm v18 ở phiên bản sau.
→ Cách phát hiện: nếu `col.models` rỗng thì đó là v18.

**Bẫy 2 — file mồi.**
Bản Anki mới nhét vào gói cả một `collection.anki2` **giả**, schema v11, chỉ chứa đúng
một thẻ ghi "hãy cập nhật Anki lên bản mới nhất". Nếu đọc `collection.anki2` đầu tiên
thì sẽ import thành công đúng một thẻ vô nghĩa. Luôn thử `anki21b` trước.

**Bẫy 3 — lịch học.**
Bộ thẻ chia sẻ thường đã bị xoá sạch dữ liệu lịch trình. Mà kể cả còn thì nó là số liệu
SM-2 (`ivl`, `factor`), không ánh xạ thẳng sang stability/difficulty của FSRS được.

→ **Import nội dung thôi, mọi thẻ vào ở trạng thái `new`.** Không cố chuyển đổi.

---

## 7. Render thẻ

Mỗi notetype có HTML mặt trước (`qfmt`), HTML mặt sau (`afmt`), và một khối CSS dùng
chung. Cần viết template engine nhỏ hỗ trợ tối thiểu:

| Cú pháp                 | Ý nghĩa                                            |
| ----------------------- | -------------------------------------------------- |
| `{{Field}}`             | thay bằng nội dung field                           |
| `{{FrontSide}}`         | chèn lại toàn bộ mặt trước vào mặt sau             |
| `{{#Field}}…{{/Field}}` | chỉ hiện nếu field không rỗng                      |
| `{{^Field}}…{{/Field}}` | chỉ hiện nếu field rỗng                            |
| `{{cloze:Text}}`        | thẻ điền khuyết, đi với `{{c1::…}}` trong nội dung |
| `{{hint:Field}}`        | nội dung ẩn, bấm mới hiện                          |
| `{{type:Field}}`        | ô gõ đáp án rồi so sánh                            |
| `{{furigana:Field}}`    | ruby text cho `漢字[かんじ]`                       |

Render vào **Shadow DOM**, không phải iframe: CSS của notetype tự động bị giới hạn
trong shadow root nên không rò ra làm vỡ app, mà không dính vấn đề đo chiều cao iframe.

**Luôn chạy qua DOMPurify trước.** HTML trong bộ thẻ tải về là code của người lạ.

Media: đăng ký service worker bắt request tới `/media/*`, trả blob từ IndexedDB. Như
vậy thẻ gốc `<img src="neko.jpg">` chỉ cần đổi đường dẫn thành `/media/neko.jpg` là
chạy, không phải quản lý vòng đời `URL.createObjectURL`.

---

## 8. Giao diện

Màn ôn thẻ là màn chiếm 95% thời gian sử dụng — thiết kế nó trước, các màn khác tính sau.

- **Một breakpoint duy nhất** ở 768px: dưới thì một cột, trên thì sidebar deck + nội dung.
- Nút đánh giá **nằm ở đáy màn hình** trên điện thoại (tầm ngón cái); trên iPad thì co
  lại và căn giữa.
- **Safe area** — dễ quên nhất khi cài lên Home Screen:
  ```html
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1, viewport-fit=cover"
  />
  ```
  và cộng `env(safe-area-inset-bottom)` vào padding thanh nút, không thì hàng nút bị
  thanh gạt home của iPhone ăn mất.
- **Không dùng `100vh`.** Safari iOS tính sai khi thanh địa chỉ ẩn/hiện. Dùng `flex: 1`
  cho khu vực thẻ.
- **Hiện khoảng thời gian dưới mỗi nút** (1 phút / 6 ngày / 11 ngày / 24 ngày). Chi
  tiết nhỏ nhưng biến việc chọn nút từ cảm tính thành có thông tin.
- Phím tắt `1 2 3 4` và `Space`. iPad có bàn phím rời thì tốc độ ôn tăng gấp đôi.

Các màn cần có: deck list, ôn thẻ, browser/tìm kiếm, soạn note, cài đặt deck, import/export.

---

## 9. Lộ trình

Làm theo thứ tự "sớm có thứ dùng được", không theo thứ tự kiến trúc.

1. **Dexie schema + màn ôn + `ts-fsrs`, thẻ nhập tay.** Xong bước này là đã học được.
2. **Import `.apkg` schema v11**, chỉ lấy text, bỏ qua media và template (render thô
   field 1 / field 2). Tốn thời gian nhất.
3. **Template engine + CSS + Shadow DOM + media qua service worker.** Lúc này bộ thẻ
   tải về mới hiện đúng như trong Anki.
4. **Hoá PWA**: manifest, service worker cache, gọi `navigator.storage.persist()` để
   iOS không dọn mất dữ liệu.
5. **Đồng bộ iPhone ↔ iPad.** Làm sau cùng. Không clone giao thức AnkiWeb. Cách rẻ
   nhất: revlog append-only đẩy lên Supabase, thiết bị nào cũng phát lại revlog để
   dựng lại trạng thái thẻ. Vì revlog chỉ thêm chứ không sửa, xung đột gần như không
   xảy ra.

---

## 10. Những thứ KHÔNG làm

- **Không export ngược ra `.apkg`.** Ghi vào định dạng đó khó gấp nhiều lần đọc, và app
  dùng một mình thì không cần. Export JSON là đủ để backup.
- Không clone giao thức đồng bộ AnkiWeb.
- Không dùng localStorage cho dữ liệu thẻ (giới hạn ~5MB, đồng bộ, chặn luồng chính).
  Chỉ dùng cho tuỳ chọn UI vặt.
- Không làm hệ thống "level" rời rạc thay cho FSRS.
- Không làm đăng nhập / nhiều người dùng.

---

## 11. Quy ước làm việc

- **Một mục tiêu mỗi session.** Commit giữa các bước. Đừng gộp cả lộ trình vào một lần.
- **Parser `.apkg` phải test bằng script Node trước khi nối vào UI.** Tải một bộ thẻ nhỏ
  về `fixtures/`, viết script in ra số note / card / media đọc được. Debug parser qua
  giao diện web rất khổ.
- Chạy `vite --host` rồi mở IP của laptop trên iPhone cùng wifi để **test trên máy thật
  sớm**. Safari iOS khác desktop nhiều thứ, biết sớm hơn là tốt.
- Trước khi đổi data model ở mục 4, đọc lại mục 6 xem có phá vỡ đường import không.
