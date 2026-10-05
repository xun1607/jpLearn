# 7. Cách làm việc

Bài này không nói về công nghệ. Nó nói về **thói quen làm việc** — thứ quyết định
dự án xong hay chết giữa đường nhiều hơn là chọn thư viện nào.

## Viết quyết định ra giấy trước khi viết code

`CLAUDE.md` được viết **trước** dòng code đầu tiên. Nó ghi:

- Vì sao PWA chứ không native.
- Stack đã chốt, không bàn lại.
- Data model, kèm câu *"không được rút gọn thành một bảng cards phẳng"*.
- **Những thứ KHÔNG làm** — cả một mục riêng.
- Thứ tự hy sinh khi thiếu thời gian.

Mục "không làm" quý ngang mục "làm":

> - Không export ngược ra `.apkg`.
> - Không clone giao thức đồng bộ AnkiWeb.
> - Không làm hệ thống "level" rời rạc thay cho FSRS.
> - Không làm đăng nhập / nhiều người dùng.

Mỗi dòng đó chặn đứng một hố sâu vài ngày công.

> **Cách nghĩ**: quyết định lúc đầu óc tỉnh táo, thực thi lúc đang cuống. Nếu chờ
> tới lúc code mới quyết thì bạn đang quyết bằng cái đầu mệt nhất.

## Khảo sát dữ liệu thật trước khi lập kế hoạch

Trước khi viết parser, soi 3 file `.apkg` thật xem bên trong có gì. Mất 15 phút.

Kết quả **làm lệch cả kế hoạch**: phát hiện 2/3 bộ thẻ dùng schema v18, mà kế hoạch
ban đầu (theo §6) lại từ chối v18. Nhìn kỹ hơn thì rào cản thật hẹp hơn nhiều so với
lời cảnh báo → hỗ trợ v18 gần như miễn phí.

Nếu cắm đầu làm theo kế hoạch, kết cục là app từ chối 2/3 bộ thẻ của chính mình.

> Kế hoạch lập trên dữ liệu tưởng tượng là kế hoạch sai.

## Test phần khó bằng script trước khi nối vào giao diện

CLAUDE.md §11 ghi rõ:

> *"Parser `.apkg` phải test bằng script Node trước khi nối vào UI. Debug parser qua
> giao diện web rất khổ."*

Làm đúng thế. `scripts/inspect-apkg.mjs` in ra:

```
=== all-in-one-kanji-deck.apkg =====================
  schema     : v11   (db: collection.anki2)
  notes      : 3787
  cards      : 7065
  --- 3 note đầu ---
    · 一  |  イチ、イツ  |  ひと-、ひと.つ
```

Vì sao đáng:

- Vòng lặp sửa–chạy tính bằng **giây**, không phải build → mở trình duyệt → bấm.
- In được số liệu thật để đối chiếu với mô tả bộ thẻ.
- **Mắt người kiểm tra được** — nhìn 一 イチ là biết ngay encoding tiếng Nhật không vỡ.

Chạy trên cả 3 file để phủ 3 nhánh: v11, v18 phẳng, v18 nén zstd.

## Khi không có công cụ, tự dựng công cụ

Phiên làm việc này **không có công cụ điều khiển trình duyệt**. Lựa chọn:

1. Bỏ qua kiểm chứng, giao hết cho người dùng thử trên điện thoại.
2. Đẩy phần kiểm chứng xuống chỗ mình chạy được.

Chọn (2): `fake-indexeddb` giả lập IndexedDB trong Node, `jsdom` cấp DOM cho
DOMPurify. `scripts/smoke-test.mjs` chạy **đúng đường mà app đi**:

```
parse .apkg → ghi Dexie → dựng hàng đợi → chấm điểm → đối chiếu revlog
```

69 kiểm tra, chạy trong vài giây, không mở trình duyệt lần nào.

Điều này chỉ khả thi vì kiến trúc đã tách sạch: scheduler, parser, template engine
đều là **pure function không đụng DOM** ([bài 01](01-tu-y-tuong-den-kien-truc.md)).
Quyết định kiến trúc hôm trước trả cổ tức hôm sau.

### Bẫy nguy hiểm nhất: test xanh mà vô nghĩa

Lần chạy đầu, test sanitize **đạt hết**. Nhưng:

> `DOMPurify` chỉ tự kích hoạt khi có `window`. Dưới Node nó im lặng trở thành
> **hàm rỗng** — `sanitize(x)` trả về `x`.

Nghĩa là test "bỏ `<script>`" đang kiểm tra một hàm không làm gì cả, và vẫn báo đạt
vì chuỗi mẫu tình cờ không khớp. Phải cấp `jsdom` **trước khi nạp code app**:

```js
const dom = new JSDOM('')
globalThis.window = dom.window
globalThis.document = dom.window.document
// … rồi mới import code app
```

> **Bài học**: test xanh không chứng minh gì cả nếu bạn chưa từng thấy nó **đỏ**.
> Với mỗi test quan trọng, hãy thử phá code một lần để xem test có bắt được không.

Cùng loại bẫy, gặp hai lần khác trong dự án:

```js
check('revlog có 1 bản ghi', async () => {})   // luôn đạt, chẳng kiểm gì
```

Hàm rỗng thì không ném lỗi → `check` đếm là đạt. Viết vội rồi quên, và nó nằm im
báo "đạt" mãi mãi.

## Tái hiện trước khi sửa

Người dùng báo: *"nhập 2 lần 1 bộ anki bị lặp"*.

Phản xạ sai: viết ngay code chống trùng. Cách làm: **tái hiện trước**.

```
sau lần 1: { decks: 2, cards: 7065, notes: 3787 }
sau lần 2: { decks: 2, cards: 7065, notes: 3787 }
```

Không hề lặp. Nhập lại đã được chống trùng từ đầu. Cái người dùng thấy "lặp" thực ra
là **thẻ anh em của cùng một note hiện liền nhau** — một vấn đề hoàn toàn khác, và
là vấn đề họ nêu ở câu trước đó.

Nếu không tái hiện thì đã viết thêm một lớp chống trùng vô dụng, còn lỗi thật vẫn nguyên.

> Cùng bài học với lỗi *"thẻ hiện mỗi số"* ở [bài 04](04-render-the.md): **mô tả của
> người dùng là triệu chứng, không phải chẩn đoán.**

## Một mục tiêu mỗi phiên, commit giữa các bước

Lịch sử commit của dự án:

```
03bc872  dexie schema + fsrs scheduler + review screen
a453d81  apkg parser (v11 + v18 text-only) + node inspect script
5592b87  import .apkg qua web worker + PWA + cấu hình Vercel
e1d7f1a  smoke test end-to-end bằng Node + fake-indexeddb
f9e42ad  template engine + Shadow DOM + CSS notetype + media qua SW
87290d1  chôn thẻ anh em + xoá bộ thẻ
676e47f  màn browser — tìm, xem và sửa thẻ
b15e645  dựng lại thẻ từ revlog — nền cho đồng bộ
2906d0f  đồng bộ tiến độ học iPhone ↔ iPad qua Supabase
```

Mỗi commit là một thứ **chạy được**. Không có commit kiểu "WIP" hay "fix stuff".

Thông điệp commit ghi **vì sao**, không chỉ ghi **cái gì**:

```
feat: chôn thẻ anh em + xoá bộ thẻ

1. Học kanji xong thì thẻ ngay sau hỏi nghĩa của đúng từ đó. Đáp án còn nguyên
   trong đầu nên FSRS đo được độ nhớ giả.

   Suy trạng thái chôn từ revlog chứ không thêm cột: chôn vẫn còn hiệu lực sau
   khi đóng app mở lại trong ngày, và không phải nâng cấp schema Dexie.
```

Ba tháng nữa, `git log` sẽ trả lời được câu "sao lại làm thế này?" — thứ mà code
không bao giờ tự trả lời được.

## Khi lệch khỏi kế hoạch thì hỏi, và ghi lại lý do

CLAUDE.md nói *"nếu thấy cần đổi thì hỏi trước"*. Dự án lệch đúng một lần — hỗ trợ
schema v18 — và lần đó:

1. Nêu rõ **vì sao rào cản hẹp hơn tài liệu nghĩ**, kèm bảng đối chiếu.
2. Hỏi trước khi làm.
3. Ghi lý do ngay trong code:

```ts
// Sai lệch có chủ đích so với §6 (đã duyệt): §6 bảo từ chối v18, nhưng rào cản
// thật sự chỉ là qfmt/afmt nằm trong protobuf. Bản text-only hôm nay không dùng
// tới chúng, mà mọi thứ nó cần ở v18 đều là cột text thường.
```

Ghi chú đó quan trọng vì §6 **vẫn còn hiệu lực** cho bước sau: khi làm template
engine thì gặp v18 lại phải báo người dùng export lại thật.

## Khi bí, tìm nguyên nhân chứ đừng thử bừa

`vercel login` báo `fetch failed`. Có thể thử lại vài lần cho tới khi may mắn. Thay
vào đó, thu hẹp dần:

```
DNS api.vercel.com      → 76.76.21.112     ✓
TCP 443                 → thành công       ✓
proxy hệ thống          → không có         ✓
IPv6                    → không có AAAA    ✓
Node fetch endpoint     → HTTP 200         ✓
```

Mọi thứ đều ổn → kết luận là trục trặc nhất thời, thử lại là hợp lý. Khác hẳn với
thử bừa: giờ đã **biết** không phải mạng, không phải proxy, không phải DNS.

> Vấp phụ đáng nhớ: `grep 'as\.vercel'` khớp nhầm bên trong chuỗi `alias.vercel.com`,
> suýt dẫn tới điều tra sai hướng. **Regex khớp giữa chuỗi** là cái bẫy kinh điển.

## Giảm cấp nhẹ nhàng ở mọi tầng đọc dữ liệu lạ

Lặp lại suốt dự án:

| Tình huống | Thay vì | Thì làm |
| ---------- | ------- | ------- |
| Bộ lọc template lạ | ném lỗi → thẻ trắng | trả rỗng, thẻ vẫn hiện |
| Không đọc được map media | huỷ import | cảnh báo, vẫn nhập nội dung |
| Gói v18 thiếu `qfmt` | từ chối bộ thẻ | hiện dạng thô + nhắc export lại |
| Template ra mặt trước rỗng | hiện thẻ trắng | lùi về dạng thô |
| Thẻ trỏ deck không tồn tại | bỏ thẻ | dồn về deck đầu + cảnh báo |

> **Nguyên tắc**: bạn không kiểm soát được dữ liệu người khác làm ra. Mỗi tầng đọc
> nó đều cần một đường lùi **vẫn dùng được**, không phải một thông báo lỗi.

## Tóm tắt

1. Viết quyết định ra giấy trước, gồm cả danh sách **không làm**.
2. Khảo sát dữ liệu thật trước khi lập kế hoạch.
3. Test phần khó bằng script, đừng debug qua giao diện.
4. Không có công cụ thì dựng công cụ; kiến trúc pure làm chuyện đó khả thi.
5. Test xanh mà chưa từng thấy đỏ thì chưa đáng tin.
6. Tái hiện trước khi sửa — mô tả của người dùng là triệu chứng.
7. Commit từng bước chạy được, thông điệp ghi **vì sao**.
8. Lệch kế hoạch thì hỏi trước và ghi lý do vào code.
9. Bí thì thu hẹp nguyên nhân, đừng thử bừa.
10. Dữ liệu người lạ thì luôn có đường lùi vẫn dùng được.

## Đọc tiếp

- [08 — Đồng bộ giữa các máy](08-dong-bo.md)
- Quay lại [mục lục](../README.md) · [nhật ký cột mốc](../MOC-MOC.md)
