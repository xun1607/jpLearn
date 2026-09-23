# 1. Từ ý tưởng tới kiến trúc

> Câu hỏi thật sự không phải "làm app flashcard thế nào" mà là **"ràng buộc nào
> quyết định mọi thứ còn lại"**.

## Tìm ràng buộc trước, chọn công nghệ sau

Bài toán: app flashcard chạy trên iPhone và iPad, một người dùng.

Phản xạ thông thường: "iPhone → làm app iOS native, Swift". Nhưng liệt kê ràng buộc
ra thì:

- Không có máy Mac.
- Không có tài khoản Apple Developer (99 USD/năm).
- App tự build bằng Apple ID free **hết hạn sau 7 ngày**, phải cắm máy build lại.

Ràng buộc thứ ba mới là thứ giết chết phương án native. Không phải "khó làm" mà là
**mỗi tuần phải cắm dây build lại** — một app học hằng ngày mà tuần nào cũng chết
thì chẳng ai dùng nổi.

PWA cài qua Safari → *Add to Home Screen*: không hết hạn, không cần Xcode, deploy free.

> **Cách nghĩ rút ra**: liệt kê ràng buộc *trước*, rồi hỏi "ràng buộc nào loại bỏ
> nhiều phương án nhất". Ràng buộc đó chọn công nghệ giùm bạn.

## Xếp hạng tính năng theo thứ tự hy sinh

Ba tính năng bắt buộc, ghi rõ trong CLAUDE.md:

1. Lặp lại ngắt quãng đúng chuẩn Anki.
2. Tuỳ biến hình thức thẻ.
3. **Import được `.apkg` từ cộng đồng Anki.**

Và một câu quan trọng: *"nếu phải hy sinh thì hy sinh theo thứ tự ngược lại: 3 quan
trọng nhất"*.

Câu đó có tác dụng thật khi lập kế hoạch ngày đầu. Thời gian không đủ cho cả 4 bước
→ bỏ bước 3 (template engine) chứ **không bỏ bước 2** (import), dù template engine
dễ làm hơn nhiều. Vì một app không import được `.apkg` chỉ là app ghi chép, còn app
hiển thị thẻ hơi xấu vẫn học được.

> Viết sẵn thứ tự hy sinh **trước khi** bị dồn vào thế phải cắt. Lúc đang cuống thì
> không ai nghĩ tỉnh táo được nữa.

## Quyết định đắt giá nhất: bám schema của Anki

Đây là chỗ dễ sai nhất và cũng là chỗ định đoạt dự án.

Cám dỗ tự nhiên là tự nghĩ ra schema "sạch" cho riêng mình:

```ts
// Cám dỗ — ĐỪNG
cards { id, front, back, level, nextReview }
```

Nhìn gọn ghẽ. Nhưng nó phá tính năng số 1 trong danh sách ưu tiên. Trong Anki:

```
notes  (một từ vựng)  ──┐
                        ├─→ card "Nhận biết"  (Nhật → Việt)   ord 0
                        └─→ card "Gợi nhớ"    (Việt → Nhật)   ord 1
```

**Một note sinh nhiều card qua nhiều template.** Nếu rút gọn thành một bảng `cards`
phẳng thì:

- Import phải bịa ra cách gộp nhiều card về một dòng — mất thông tin.
- Sửa nghĩa của từ phải sửa ở nhiều chỗ.
- `ord` không còn chỗ để lưu → không biết card này dùng template nào.

Chính chỗ này về sau gây ra lỗi *"thẻ hiện mỗi số"* — không phải vì schema sai, mà
vì tầng render **quên dùng `ord`**. Schema đúng nên chỉ cần sửa một chỗ.

> **Quy tắc**: khi phải nhập dữ liệu từ hệ thống khác, hãy bám schema của nó. Mỗi
> chỗ bạn "cải tiến" là một chỗ phải viết code chuyển đổi, và chuyển đổi thì luôn
> mất mát.

## Ranh giới kiến trúc: cái gì được đụng DOM

```
Giao diện (React)
├── Scheduler (ts-fsrs)   ── pure, không DOM
├── Parser .apkg          ── pure, không DOM
├── Template engine       ── pure, không DOM
├── Dexie / IndexedDB
└── Service Worker: offline shell + phục vụ media
```

Nguyên tắc: **logic scheduler, parser và template là pure function**, không đụng DOM.

Không phải để cho đẹp. Lý do rất cụ thể: phiên làm việc này **không có công cụ
trình duyệt**. Nhờ ba tầng đó pure nên chạy được bằng Node và kiểm chứng được 69
trường hợp mà không cần mở trình duyệt lần nào. Nếu template engine gọi
`document.createElement` thì đã không test được dòng nào.

Xem [07 — Cách làm việc](07-cach-lam-viec.md) để thấy nó trả cổ tức thế nào.

## Vì sao không dùng thư viện quản lý state

CLAUDE.md ghi: *"Không dùng: backend bắt buộc, ORM nặng, state library (Dexie live
query là đủ)"*.

Dexie có `useLiveQuery`: truy vấn IndexedDB, và **tự chạy lại khi dữ liệu đổi**.

```tsx
const decks = useLiveQuery(() => db.decks.orderBy('name').toArray(), [])
```

Xoá một deck ở chỗ khác → danh sách tự cập nhật. Không cần Redux, không cần Zustand,
không cần `invalidateQueries`. Với app một người dùng mà **IndexedDB chính là nguồn
sự thật duy nhất**, thêm một tầng state nữa chỉ tạo ra hai bản sao phải giữ đồng bộ.

> Hỏi "nguồn sự thật nằm ở đâu" trước khi chọn thư viện state. Nếu nó đã nằm trong
> một cái database biết phát tín hiệu thay đổi, bạn không cần thư viện nào cả.

## Đọc tiếp

- [02 — Thuật toán lặp lại](02-thuat-toan-lap-lai.md)
- [03 — Đọc file `.apkg`](03-doc-file-apkg.md)
