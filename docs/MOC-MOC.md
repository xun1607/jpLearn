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

### `676e47f` — Màn browser: tìm, xem, sửa thẻ

Màn cuối còn thiếu trong danh sách §8.

- Tìm kiếm cú pháp Anki: từ khoá AND, `-loại-trừ`, `"cụm trong nháy"`, `deck:`,
  `tag:`, `is:new/learn/review/due/suspended`.
- Sửa note (field + tag), tạm dừng thẻ, chuyển deck, xoá note. Giống Anki: danh
  sách liệt kê **card** còn ô sửa thì sửa **note**.
- Xem thử hai mặt thẻ ngay trong lúc sửa, dùng chung `CardView` của màn ôn.

> **Vấp — và là lỗi nghiêm trọng nhất tìm ra từ đầu dự án.** Test treo quá 10
> phút. Đo từng bước thay vì đoán:
>
> ```
>    243ms  runSearch('')
>  67587ms  runSearch('deck:All')     ← 67 GIÂY
> ```
>
> Thủ phạm là `db.cards.where('deckId').anyOf([id])`. `anyOf` tối ưu cho "vài
> khoá, mỗi khoá ít hàng"; ở đây một khoá ứng với cả bảng nên nó dò lại index cho
> từng hàng. Đổi sang `equals(id)`: **103ms**, nhanh gấp 650 lần. `deleteDeck`
> cũng dính, đã viết lại theo lối quét một lượt.
>
> Lỗi này **không sai kết quả**, chỉ chậm — nên test thường không bắt được. Đã
> thêm hàng rào thời gian cho riêng nó.

> **Vấp phụ**: `fake-indexeddb` xoá 1000 hàng mất **90 giây** (IndexedDB thật thì
> không). Phần test xoá deck chuyển sang deck nhỏ tự dựng — cái cần kiểm là ngữ
> nghĩa chứ không phải quy mô. Biết giới hạn của công cụ test cũng quan trọng
> như biết giới hạn của code.

---

## 2026-10-05 · Ngày 3 — đồng bộ iPhone ↔ iPad

Câu hỏi bắt đầu: *"làm sao lưu session học qua các thiết bị mà không bị mất?"*

### Trước khi viết code: database hiện tại có làm được không?

Không. IndexedDB nằm riêng trong từng máy — thậm chí tab Safari và app trên Home
Screen của **cùng một** iPhone cũng không thấy nhau. Cần một chỗ trên mạng.

§9 đã chốt hướng: revlog append-only lên Supabase, máy nào cũng phát lại. Nhưng
hướng đó chỉ đúng nếu **phát lại ra đúng y trạng thái cũ**. FSRS có fuzz (rải ngẫu
nhiên ngày tới hạn) — nếu fuzz dùng `Math.random` thì hai máy phát lại sẽ ra hai
lịch khác nhau. Mở mã nguồn ts-fsrs ra đọc:

```js
function DefaultInitSeedStrategy() {
  const time = this.review_time.getTime();
  const reps = this.current.reps;
  const mul = this.current.difficulty * this.current.stability;
  return `${time}_${reps}_${mul}`;
}
```

Seed tất định → phát lại được → **server không cần giữ trạng thái thẻ**, chỉ giữ
revlog. Đây là phát hiện quyết định cả thiết kế.

**Lệch có duyệt**: §10 ghi "không làm đăng nhập". Hỏi lại và được duyệt: một tài
khoản duy nhất, tắt đăng ký. Không có đăng nhập thì RLS không biết revlog là của ai.

### `b15e645` — Dựng lại thẻ từ revlog

Bước 1/3, chưa đụng mạng.

- Dexie v2: revlog thêm `uid` (khoá toàn cục) và `synced`. Khoá chính `++id` giữ
  nguyên vì IndexedDB không cho đổi khoá chính; dòng cũ được cấp uid khi nâng cấp.
- `replayCard()` pure: xếp theo thời điểm rồi theo uid, để máy nào phát lại cũng
  cùng thứ tự.
- `recordReview()` gom việc ghi thẻ + revlog, trước nằm trong `ReviewScreen`.
- Nhập `.apkg` sau khi đã kéo revlog về: thẻ tự khôi phục tiến độ.

Test: 80 thẻ / 1648 lần ôn ngẫu nhiên, phát lại khớp **từng trường**. Kèm đối chứng
âm: đổi một lần chấm thì phải lệch — để chắc test không phải hàm rỗng.

### `2906d0f` — Đẩy/kéo revlog qua Supabase

Chia theo SOLID, chủ yếu S và D: engine chỉ biết interface `SyncRemote`; Supabase
là một bản cài, `memoryRemote` là bản giả cho test. Nhờ vậy test được cảnh **hai
máy** bằng hai DB Dexie trong cùng một process, không cần mạng.

Ba chi tiết đáng nhớ:

1. **Ghi revlog kéo về và dựng lại thẻ phải chung một transaction.** Tách đôi thì
   app tắt giữa chừng để lại revlog đã ghi mà thẻ chưa dựng lại — lần sau dòng đó
   bị coi là trùng nên không ai sửa nữa.
2. **Con trỏ `seq` có lỗ.** Postgres cấp seq lúc INSERT, không phải lúc COMMIT:
   iPhone lấy seq 10 nhưng commit chậm, iPad lấy 11 commit trước. Máy kéo đúng lúc
   đó nhớ con trỏ = 11 và bỏ sót dòng 10 vĩnh viễn. Cách chữa: mỗi lần kéo lùi 200
   dòng rồi lọc trùng bằng uid.
3. **Append-only ép ở database**, không chỉ trông vào code: RLS chỉ có policy
   `select` + `insert`, không có `update`/`delete`.

Test 34 kiểm tra. Đã **cố tình phá** hai chỗ để xem test có đỏ không: đặt
`PULL_OVERLAP = 0` → bắt được; bỏ bước dựng lại thẻ → 9 kiểm tra đỏ.

> Vấp: script `check-supabase` ban đầu dùng `select(…, { head: true })` để dò
> bảng, và báo **"bảng revlog có"** khi chưa tạo bảng nào. Request HEAD lên bảng
> không tồn tại vẫn trả `204` thành công. Đúng loại lỗi của ngày 1 với DOMPurify:
> công cụ kiểm tra im lặng nói dối. Phát hiện được vì *biết trước* bảng chưa có
> mà nó lại bảo có.

> Vấp phụ: thêm `supabase-js` làm bundle chính tăng 130 → 189 KB gzip. Tách ra
> chunk riêng nạp bằng `import()` sau khi app hiện → bundle chính về 133 KB.
> Service worker vẫn precache chunk đó nên offline không ảnh hưởng.

> Không dùng magic link: trên iOS, link trong mail mở bằng Safari chứ không vào
> app đã cài — đăng nhập xong ở Safari còn app vẫn chưa đăng nhập.

---

## Trạng thái hiện tại

Xong bước 1, 2, 3, 4 của lộ trình §9, màn browser, và phần chính của bước 5:
**tiến độ học đồng bộ giữa các máy**. `npm run smoke` 119 kiểm tra đạt,
`npm run test:sync` 34 kiểm tra đạt.

Chưa làm:

- Đồng bộ thao tác sửa (thẻ gõ tay, sửa note, tạm dừng, chuyển deck, xoá) — cần
  một bảng `ops` tương tự revlog.
- Đồng bộ bộ thẻ `.apkg` + media — hiện nhập tay trên từng máy.
- Cài đặt deck, export JSON.
- Gói schema v18 vẫn chưa đọc được `qfmt`/`afmt` — đúng như §6 nói, app báo người
  dùng export lại với *"Support older Anki versions"*.
