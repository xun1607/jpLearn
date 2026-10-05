# Thẻ — flashcard PWA
WEB app: cloneanki.vercel.app

Clone Anki cho web di động. Repo: `jpLearn`.

Xem [CLAUDE.md](CLAUDE.md) cho bối cảnh và các quyết định thiết kế.
Tài liệu chi tiết trong [docs/](docs/) — [nhật ký cột mốc](docs/MOC-MOC.md) và
[loạt bài giải thích cách nghĩ](docs/README.md).

## Lệnh

```bash
npm run dev        # vite --host, mở IP laptop trên iPhone cùng wifi
npm run build
npm run preview    # bản build thật, cũng --host
npm run typecheck

npm run inspect -- "D:/DOWNLOAD/deck.apkg"   # soi gói .apkg, không đụng UI
npm run smoke   -- "D:/DOWNLOAD/deck.apkg"   # test end-to-end bằng fake-indexeddb
npm run test:sync                            # test đồng bộ: 2 máy giả lập + server giả
npm run check:supabase                       # kiểm phía Supabase đã cài đúng chưa
node scripts/make-icons.mjs                  # sinh lại icon PWA
node scripts/compare-dbs.mjs <file.apkg>     # đếm note trong từng DB của gói
```

## Đã xong

Bước 1, 2, 3, 4 của lộ trình §9, và phần chính của bước 5 (đồng bộ tiến độ học).

- Dexie theo schema Anki, note ≠ card, `ord` trỏ template.
- FSRS qua `ts-fsrs`: 4 nút, nhãn khoảng thời gian, phím tắt `1 2 3 4` + `Space`.
- Nhập `.apkg` trong Web Worker, hỗ trợ **cả schema v11 lẫn v18** (xem bên dưới).
- Màn browser: tìm kiếm kiểu Anki, sửa field/tag, tạm dừng, chuyển deck, xoá note.
- Template engine Anki + CSS notetype render trong Shadow DOM.
- Media (ảnh, `[sound:…]`) phục vụ từ IndexedDB qua service worker.
- PWA cài được vào Home Screen, `navigator.storage.persist()`.
- Đồng bộ tiến độ học iPhone ↔ iPad qua Supabase (xem bên dưới).

### Template engine

`src/lib/template/render.ts` — pure, test bằng Node. Hỗ trợ `{{Field}}`,
`{{FrontSide}}`, `{{#Field}}`/`{{^Field}}` lồng nhau, `{{cloze:…}}` theo `ord`,
`{{hint:…}}`, `{{type:…}}` có chấm điểm, `{{furigana:…}}`, cộng `text`/`kana`/`kanji`.
Bộ lọc lạ (`tts`) trả rỗng thay vì làm vỡ thẻ.

**`card.ord` chọn template.** Một note sinh nhiều thẻ qua nhiều template — bộ
all-in-one-kanji có "Recognition" hỏi `{{Kanji}}` và "Recall" hỏi `{{English}}`.
Bỏ qua `ord` là cả hai thẻ trông y hệt nhau.

### Tìm kiếm

```
漢字                    chữ nào cũng phải có (AND)
-がっこう                loại bỏ
deck:N5                 tên deck chứa "N5"
deck:"Nhật Bản::N5"     tên có dấu cách thì bọc nháy
tag:động-từ              có tag này
is:new is:due is:suspended is:learn is:review
```

## Đồng bộ

Server chỉ giữ **lịch sử ôn** (revlog, chỉ thêm không sửa). Mỗi máy kéo về rồi
tự phát lại bằng `ts-fsrs` để tính trạng thái thẻ — làm được vì ts-fsrs tất
định, kể cả fuzz.

```
src/sync/remote.ts     interface SyncRemote — engine chỉ biết cái này
src/sync/engine.ts     syncOnce(): đẩy revlog chờ → kéo phần mới theo seq
src/sync/local.ts      phía Dexie: ghi revlog kéo về + dựng lại thẻ, một transaction
src/sync/supabase.ts   bản cài thật; memoryRemote.ts là bản giả cho test
src/sync/service.ts    khi nào đồng bộ: sau khi chấm (gom 3s), mở/rời app, có mạng, 5 phút
```

Cài phía Supabase (một lần):

1. SQL Editor → dán [`supabase/schema.sql`](supabase/schema.sql) → Run.
2. Authentication → Users → Add user → Create new user, tick **Auto Confirm User**.
3. Authentication → Sign In / Providers → tắt **Allow new users to sign up**.
4. `npm run check:supabase` phải báo "Phía Supabase đã sẵn sàng".

Rồi trên từng máy: mở **app đã cài ở Home Screen** → dòng ☁ dưới ô tìm kiếm →
đăng nhập.

Bộ thẻ `.apkg` **không** đồng bộ — nhập trên từng máy. Id thẻ lấy từ Anki nên
hai máy khớp nhau; nhập sau khi đã đồng bộ thì tiến độ tự khôi phục.

## Chưa làm

- Đồng bộ thao tác sửa: thẻ gõ tay, sửa note, tạm dừng, chuyển deck, xoá —
  hiện chỉ nằm trên máy làm thao tác đó.
- Đồng bộ bộ thẻ `.apkg` + media (Supabase Storage).
- Cài đặt deck, export JSON.
- Gói schema v18 không đọc được `qfmt`/`afmt` nên vẫn hiện dạng thô — đúng như
  §6 nói, app báo người dùng export lại với _"Support older Anki versions"_.

## Ghi chú về `.apkg`

`src/lib/apkg/parse.ts` đọc được nhiều hơn §6 mô tả, vì bản text-only không cần
`qfmt`/`afmt` — thứ duy nhất nằm trong protobuf ở schema v18.

| Nội dung        | v11                    | v18                          |
| --------------- | ---------------------- | ---------------------------- |
| note, card      | bảng `notes` / `cards` | y hệt                        |
| tên field/deck  | JSON trong `col`       | bảng `fields` / `decks`      |
| `qfmt` / `afmt` | JSON trong `col`       | protobuf — **chưa đọc được** |

Bước 3 (template engine) đã làm xong nhưng phần này vẫn vậy: gặp v18 thì hiện
dạng thô và nhắc người dùng export lại với _"Support older Anki versions"_.

Ba cái bẫy ở §6 đều gặp thật khi test:

- **Bẫy 2 có thật** — `collection.anki2` trong gói MIMIKARA đúng là file mồi chứa
  1 note. Bản thật nằm ở `collection.anki21`.
- File ánh xạ `media` của gói `.anki21b` là **zstd bọc protobuf**, không phải JSON
  như §6 mô tả. `src/lib/apkg/media.ts` xử lý cả ba dạng.
- Thẻ nhập vào luôn ở trạng thái `new`, không chuyển `ivl`/`factor` sang FSRS.

## Bẫy iOS khi test

App đã cài vào Home Screen dùng **kho IndexedDB riêng**, tách hẳn khỏi Safari.
Nhập `.apkg` trong tab Safari rồi mở app từ Home Screen sẽ thấy trống trơn.
→ Luôn nhập bộ thẻ từ **bên trong app đã cài**.
