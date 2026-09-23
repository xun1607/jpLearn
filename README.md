# Thẻ — flashcard PWA
WEB app: cloneanki.vercel.app

Xem [CLAUDE.md](CLAUDE.md) cho bối cảnh và các quyết định thiết kế.

## Lệnh

```bash
npm run dev        # vite --host, mở IP laptop trên iPhone cùng wifi
npm run build
npm run preview    # bản build thật, cũng --host
npm run typecheck

npm run inspect -- "D:/DOWNLOAD/deck.apkg"   # soi gói .apkg, không đụng UI
npm run smoke   -- "D:/DOWNLOAD/deck.apkg"   # test end-to-end bằng fake-indexeddb
node scripts/make-icons.mjs                  # sinh lại icon PWA
node scripts/compare-dbs.mjs <file.apkg>     # đếm note trong từng DB của gói
```

## Đã xong

Bước 1, 2, 3, 4 của lộ trình §9.

- Dexie theo schema Anki, note ≠ card, `ord` trỏ template.
- FSRS qua `ts-fsrs`: 4 nút, nhãn khoảng thời gian, phím tắt `1 2 3 4` + `Space`.
- Nhập `.apkg` trong Web Worker, hỗ trợ **cả schema v11 lẫn v18** (xem bên dưới).
- Template engine Anki + CSS notetype render trong Shadow DOM.
- Media (ảnh, `[sound:…]`) phục vụ từ IndexedDB qua service worker.
- PWA cài được vào Home Screen, `navigator.storage.persist()`.

### Template engine

`src/lib/template/render.ts` — pure, test bằng Node. Hỗ trợ `{{Field}}`,
`{{FrontSide}}`, `{{#Field}}`/`{{^Field}}` lồng nhau, `{{cloze:…}}` theo `ord`,
`{{hint:…}}`, `{{type:…}}` có chấm điểm, `{{furigana:…}}`, cộng `text`/`kana`/`kanji`.
Bộ lọc lạ (`tts`) trả rỗng thay vì làm vỡ thẻ.

**`card.ord` chọn template.** Một note sinh nhiều thẻ qua nhiều template — bộ
all-in-one-kanji có "Recognition" hỏi `{{Kanji}}` và "Recall" hỏi `{{English}}`.
Bỏ qua `ord` là cả hai thẻ trông y hệt nhau.

## Chưa làm

Bước 5 (đồng bộ iPhone ↔ iPad), browser/tìm kiếm, cài đặt deck, export JSON.
Gói schema v18 không đọc được `qfmt`/`afmt` nên vẫn hiện dạng thô — đúng như §6
nói, app báo người dùng export lại với _"Support older Anki versions"_.

## Ghi chú về `.apkg`

`src/lib/apkg/parse.ts` đọc được nhiều hơn §6 mô tả, vì bản text-only không cần
`qfmt`/`afmt` — thứ duy nhất nằm trong protobuf ở schema v18.

| Nội dung        | v11                    | v18                          |
| --------------- | ---------------------- | ---------------------------- |
| note, card      | bảng `notes` / `cards` | y hệt                        |
| tên field/deck  | JSON trong `col`       | bảng `fields` / `decks`      |
| `qfmt` / `afmt` | JSON trong `col`       | protobuf — **chưa đọc được** |

Khi làm bước 3 sẽ phải quay lại: gặp v18 thì báo người dùng export lại với tuỳ
chọn _"Support older Anki versions"_, đúng như §6 nói.

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
