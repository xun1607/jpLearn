# Nhật ký cột mốc

Ghi theo commit. Mỗi mục trả lời: **làm gì**, và quan trọng hơn — **vì sao**, và
**đã vấp gì**.

---

## 2026-09-22 · Ngày 1

Mục tiêu đặt ra buổi sáng: *tới mai có app trên điện thoại để học từ vựng*.

### Trước khi viết dòng code nào

Khảo sát 3 file `.apkg` có sẵn trong `D:\DOWNLOAD` — **soi trước, không giải nén**,
bằng `System.IO.Compression.ZipFile` và quét chuỗi trong byte thô. Mục đích: biết
sẽ phải đối mặt với schema nào.

| File | DB thật | Kết luận sơ bộ |
| ---- | ------- | -------------- |
| `all-in-one-kanji-deck` | `collection.anki2` | v11 sạch |
| `MIMIKARA_OBOERU_N2` | `collection.anki21` | có bảng `notetypes` → nghi v18 |
| `Manh JPN ver4` | `collection.anki21b` | v18, nén zstd |

Kết quả khảo sát này **làm lệch kế hoạch ngay từ đầu**: CLAUDE.md §6 bảo MVP chỉ
hỗ trợ v11, gặp v18 thì bắt export lại. Nhưng vì phạm vi ngày đầu bỏ template
engine, mà `qfmt`/`afmt` mới là thứ duy nhất nằm trong protobuf ở v18 → hỗ trợ v18
gần như miễn phí. Hỏi lại và được duyệt trước khi lệch.

> **Bài học**: khảo sát dữ liệu thật trước khi lập kế hoạch. Nếu cắm đầu làm theo
> §6 thì 2 trong 3 bộ thẻ sẽ bị từ chối vô cớ.

### `03bc872` — Dexie + FSRS + màn ôn

Bước 1 lộ trình. Xong là đã học được bằng thẻ gõ tay.

- Data model bám sát Anki: `notetypes / decks / notes / cards / revlog / media / config`.
  Note và card tách riêng, `card.ord` trỏ index template.
- `CardRow` **nhúng thẳng** `Card` của ts-fsrs. Lý do: `scheduler.next(row, …)` nhận
  được row nguyên vẹn, khỏi lớp map qua lại giữa hai hình dạng dữ liệu.
- Màn ôn: `flex-1` (không `100vh`), thanh nút cộng `env(safe-area-inset-bottom)`,
  nhãn khoảng thời gian dưới mỗi nút, phím tắt `1 2 3 4` + `Space`.

### `a453d81` — Parser `.apkg`

Bước 2, phần tốn thời gian nhất. Theo đúng §11: **viết script Node in ra số liệu
trước, không nối UI**.

Ba phát hiện khi chạy thật:

1. **Bẫy 2 của §6 có thật.** Chạy `scripts/compare-dbs.mjs` đếm note trong *từng*
   DB của gói:

   ```
   MIMIKARA: collection.anki21  notes=20   ← bản thật
             collection.anki2   notes=1    ← file mồi
   ```

   Nếu đọc `collection.anki2` trước thì import thành công đúng 1 thẻ vô nghĩa.

2. **File ánh xạ `media` có 3 dạng, §6 chỉ nói 1.** Gói `.anki21b` dùng **zstd bọc
   protobuf**, không phải JSON. Phải viết bộ đọc protobuf tối thiểu (~60 dòng) trong
   `src/lib/apkg/media.ts`.

3. **`MIMIKARA` hoá ra là bản dùng thử.** Tên deck ghi "FULL 1147 TỪ VỰNG — LIÊN HỆ
   ZALO" nhưng trong file chỉ có **20 note**. `Manh JPN ver4` chỉ có **1 note**. Chỉ
   `all-in-one-kanji` là bộ thật (3787 note / 7065 thẻ).

### `5592b87` — Worker + PWA + Vercel

- Import chạy trong Web Worker (§3), luồng chính ghi Dexie vì `useLiveQuery` ở đó
  mới thấy thay đổi.
- Nhập lại cùng một gói **không xoá tiến độ**: thẻ nào đã có thì giữ, chỉ thêm thẻ mới.
- Deck rỗng bị bỏ qua — deck "Default" id=1 sẽ đè deck mặc định của app.
- Icon PWA sinh bằng script tự viết (`scripts/make-icons.mjs`), không cần thư viện ảnh.

  > Vấp: viết sai độ dài chunk PNG (`8 + body + 4` thay vì `4 + body + 4`), thừa 4
  > byte mỗi chunk nên file hỏng. Phát hiện được là nhờ viết script kiểm tra ngược
  > lại PNG chứ không phải nhìn bằng mắt.

- `sw.js` precache cả `sql-wasm.wasm` → nhập thẻ chạy được cả khi offline.

### `e1d7f1a` — Smoke test bằng Node

Phiên làm việc không có công cụ trình duyệt. Thay vì bỏ qua phần kiểm chứng, đẩy
nó xuống Node bằng `fake-indexeddb`: parse → ghi Dexie → dựng hàng đợi → chấm điểm
→ đối chiếu revlog.

> Vấp: `DOMPurify` chỉ tự kích hoạt khi có `window`. Dưới Node nó im lặng trở thành
> **hàm rỗng** — test sanitize vẫn "đạt" mà chẳng kiểm tra gì. Phải cấp `jsdom`
> trước khi nạp code app. Đây là loại lỗi nguy hiểm nhất: test xanh nhưng vô nghĩa.

### `bece0e0` → deploy

Vercel CLI login báo `fetch failed`. Truy ngược: DNS, TCP 443, proxy, IPv6 đều bình
thường; gọi thẳng endpoint OAuth bằng Node thì **HTTP 200**. Kết luận là trục trặc
nhất thời phía máy, thử lại lần hai là qua.

> Vấp phụ: `grep 'as\.vercel'` khớp nhầm trong chuỗi `alias.vercel.com`, suýt đi
> điều tra sai hướng. Regex khớp giữa chuỗi là cái bẫy kinh điển.

**Kết quả ngày 1**: <https://cloneanki.vercel.app> — cài được vào Home Screen.

---

## 2026-09-23 · Ngày 2

### `f9e42ad` — Template engine + Shadow DOM + media

Dùng thật thì lộ ra: *"thẻ trước nó hiện mỗi số, nhấn hiện sau mới ra tất cả thông tin"*.

Chẩn đoán: bộ `all-in-one-kanji` có **2 template** —

| Template | Mặt trước thật | App hiện |
| -------- | -------------- | -------- |
| `Recognition` (ord 0) | `{{Kanji}}` → 一 | 一 ✓ |
| `Recall` (ord 1) | `{{English}}` → "one" | **一** ✗ |

App **bỏ qua `card.ord`** nên hai thẻ của cùng một note giống hệt nhau. Và vì bộ
thẻ xếp theo tần suất nên vài thẻ đầu là 一 二 三 — kanji của số 1, 2, 3. Nhìn đúng
là "hiện mỗi số" thật.

Sửa bằng cách làm nốt bước 3 của lộ trình:

- `src/lib/template/render.ts` — `{{Field}}`, `{{FrontSide}}`, `{{#}}`/`{{^}}` lồng
  nhau, `{{cloze:}}` theo `ord`, `{{hint:}}`, `{{type:}}` có chấm điểm,
  `{{furigana:}}`, cộng `text`/`kana`/`kanji`.
- Render vào **Shadow DOM** cùng CSS của notetype (§7) — không iframe.
- `src/sw.ts` phục vụ `/media/*` từ IndexedDB.

> Vấp 1: chuyển sang `injectManifest` thì build chết vì `workbox-build` tìm đúng
> chuỗi `self.__WB_MANIFEST` trong file đã bundle. Gán `const sw = self as …` rồi
> viết `sw.__WB_MANIFEST` là bundler nội suy đi mất, không tìm thấy.
>
> Vấp 2: **Safari luôn gửi `Range` cho audio.** Trả nguyên 200 thì không tua được
> và có bản còn không phát. Phải cắt blob và trả 206 kèm `Content-Range`.

### `87290d1` — Chôn thẻ anh em + xoá bộ thẻ

Hai vấn đề gặp khi dùng thật.

**1. Thẻ anh em hiện liền nhau.** Học kanji xong thì thẻ ngay sau hỏi nghĩa tiếng
Việt của đúng từ đó. Đáp án còn nguyên trong đầu → FSRS đo được **độ nhớ giả**.
Giờ mỗi note chỉ ra một thẻ mỗi ngày.

Cách cài: suy trạng thái chôn **từ revlog** chứ không thêm cột vào schema. Lợi ích
kép — chôn vẫn còn hiệu lực sau khi đóng app mở lại trong ngày, và không phải nâng
cấp schema Dexie.

> Vấp: `pickNewCards` ban đầu lấy một phát `limit(hạn_mức × 4)` rồi lọc. Notetype
> nhiều template thì cả trang có thể là thẻ anh em của vài note, lọc xong còn dúm
> dó và hôm đó học hụt hẳn hạn mức. Đổi sang quét theo trang cho tới khi đủ số note
> khác nhau.

**2. Chưa có cách xoá bộ thẻ.** `deleteDeck` xoá kèm deck con, revlog, và **chỉ xoá
note khi không còn thẻ nào trỏ tới** — một note có thể có thẻ nằm ở deck khác.

> Đáng chú ý: người dùng báo "nhập 2 lần bị lặp", nhưng chạy thử thì **không hề lặp**
> — deck id `1431188075243` được giữ nguyên, sau 2 lần nhập vẫn đúng 7065 thẻ. Cái
> thấy "lặp" chính là thẻ anh em hiện liền nhau. Luôn tái hiện trước khi sửa.

---

## Trạng thái hiện tại

Xong bước 1, 2, 3, 4 của lộ trình §9. **69 kiểm tra đạt** trong `npm run smoke`.

Chưa làm: đồng bộ iPhone ↔ iPad (bước 5), browser/tìm kiếm, cài đặt deck, export JSON.
Gói schema v18 vẫn chưa đọc được `qfmt`/`afmt` — đúng như §6 nói, app báo người dùng
export lại với *"Support older Anki versions"*.
