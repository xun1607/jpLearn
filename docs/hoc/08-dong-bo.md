# 8. Đồng bộ giữa các máy

> Câu hỏi không phải "đồng bộ cái gì" mà là **"cái gì là nguồn sự thật, cái gì
> chỉ là hệ quả"**. Đồng bộ nguồn, tính lại hệ quả.

## Vì sao database trong máy không làm được

IndexedDB nằm trong từng trình duyệt của từng máy. iPhone không thấy iPad. Tệ hơn:
trên **cùng một** iPhone, tab Safari và app đã cài ở Home Screen giữ hai kho riêng
([bài 05](05-giao-dien-mobile.md)).

→ Muốn hai máy dùng chung dữ liệu thì phải có một chỗ trên mạng. Supabase cho sẵn
Postgres + đăng nhập + REST gọi thẳng từ trình duyệt, nên không phải viết server.
App vẫn chạy offline 100% — đồng bộ chỉ là lớp thêm vào.

## Nguồn sự thật là revlog, không phải thẻ

Cách ngây thơ: đẩy cả bảng `cards` lên, ai sửa sau thắng.

```
iPhone offline: ôn thẻ X lúc 9h  → stability 3,2
iPad   offline: ôn thẻ X lúc 10h → stability 1,1
đồng bộ: "ai sau thắng" → mất lần ôn lúc 9h
```

Mất dữ liệu, và mất **lặng lẽ**. Trạng thái thẻ là **hệ quả** của chuỗi lần ôn;
lần ôn mới là **sự kiện** thật. Gộp hai danh sách sự kiện thì không bao giờ xung đột
— chỉ cần xếp theo thời gian rồi tính lại.

```
server: chỉ revlog (chỉ thêm, không sửa)
máy:    trạng thái thẻ = phát_lại(revlog của thẻ đó)
```

> Đây là ý tưởng *event sourcing*. Nghe to tát nhưng bản chất đơn giản: **lưu cái
> đã xảy ra, đừng lưu kết luận**. Kết luận tính lại được; sự kiện mất là mất.

Cùng nguyên tắc với [bài 02](02-thuat-toan-lap-lai.md) khi đếm hạn mức thẻ mới:
*cái gì suy ra được từ dữ liệu đã có thì đừng lưu thêm.*

## Điều kiện để phát lại được: thuật toán phải tất định

FSRS có fuzz — rải ngẫu nhiên ngày tới hạn. Nếu "ngẫu nhiên" là `Math.random` thì
iPhone phát lại ra hạn ngày 12, iPad ra ngày 13. Cả thiết kế sụp.

Không đoán — **mở mã nguồn thư viện ra đọc**:

```js
function DefaultInitSeedStrategy() {
  const time = this.review_time.getTime();
  const reps = this.current.reps;
  const mul = this.current.difficulty * this.current.stability;
  return `${time}_${reps}_${mul}`;
}
```

Seed lấy từ dữ liệu của chính lần ôn → cùng đầu vào thì cùng đầu ra. Rồi **chứng
minh bằng test** chứ không tin suông: ôn ngẫu nhiên 1648 lần trên 80 thẻ, phát lại,
so khớp từng trường.

> Một chi tiết nhỏ hệ quả: `reviewed_at` trên server phải giữ đủ mili-giây, vì seed
> dùng đúng con số đó. Postgres `timestamptz` giữ tới micro-giây nên đi về nguyên vẹn.

## Chống trùng bằng khoá toàn cục

Revlog cũ có khoá `++id` tự tăng — iPhone có dòng id 5, iPad cũng có dòng id 5, là
hai lần ôn khác nhau. Không dùng làm khoá chung được.

Mỗi dòng mang thêm `uid` (UUID) sinh lúc ôn. Từ đó mọi thao tác đều **lặp lại được
mà vô hại**:

| Tình huống | Kết quả |
| ---------- | ------- |
| Đẩy lên, mất mạng trước khi biết server đã nhận | đẩy lại → server bỏ qua trùng uid |
| Kéo về dòng của chính mình | máy bỏ qua vì uid đã có |
| Kéo lùi để vớt dòng sót (xem dưới) | dòng đã có bị bỏ qua |

> **Nguyên tắc**: trên mạng không đáng tin, thiết kế để mọi thao tác *làm hai lần
> cũng như làm một lần* (idempotent). Rồi khi nghi ngờ, cứ làm lại.

## Cái bẫy của con trỏ tăng dần

Máy nhớ "đã kéo tới seq nào", lần sau hỏi phần mới hơn. Nghe đúng, nhưng:

```
iPhone INSERT  → lấy seq 10 … (commit chậm)
iPad   INSERT  → lấy seq 11 → commit
máy C kéo về   → thấy 11, nhớ con trỏ = 11
iPhone         → … commit seq 10   ← máy C không bao giờ hỏi lại seq 10
```

Postgres cấp seq lúc **bắt đầu** INSERT, không phải lúc commit. Cách chữa rẻ nhất:
mỗi lần kéo **lùi con trỏ 200 dòng**, dòng đã có thì uid tự lọc.

Có test riêng cho nó, và đã thử đặt độ lùi về 0 để xem test có đỏ không — có.

## Transaction: hai bước phải là một

Kéo về gồm hai việc: ghi revlog, rồi dựng lại thẻ. Nếu tách hai transaction:

```
ghi revlog ✓ → app bị iOS đóng → dựng lại thẻ ✗
lần sau: dòng đã có uid → bỏ qua → thẻ KHÔNG BAO GIỜ được dựng lại
```

Chính cơ chế chống trùng ở trên biến một lần gián đoạn thành lỗi vĩnh viễn. Gộp vào
một transaction: hoặc cả hai, hoặc không gì cả.

> Khi thêm một cơ chế "bỏ qua cái đã có", hãy hỏi: *nếu "đã có" mà chưa xong thì sao?*

## SOLID ở đây nghĩa là gì

Hai chữ có tác dụng thật:

**S — mỗi module một việc.**

```
engine.ts    đồng bộ THẾ NÀO   (đẩy rồi kéo, con trỏ, phân trang)
service.ts   đồng bộ KHI NÀO   (sau khi chấm, mở app, có mạng, 5 phút)
local.ts     đọc/ghi phía máy  (Dexie)
supabase.ts  đọc/ghi phía mạng
```

Tách "thế nào" khỏi "khi nào" là để engine **test được bằng Node** — không timer,
không sự kiện trình duyệt, không đăng nhập.

**D — phụ thuộc vào interface, không vào Supabase.**

```ts
interface SyncRemote {
  pushRevlog(rows): Promise<void>
  pullRevlog(after, limit): Promise<PulledRevlog[]>
}
```

Engine chỉ biết interface này. Test thay Supabase bằng `memoryRemote` — một server
giả 50 dòng — và giả lập được cả hai máy, mất mạng, đẩy trùng, dòng commit muộn.
Mai muốn bỏ Supabase thì viết lại đúng một file.

Ba chữ còn lại (O, L, I) áp nhẹ. App một người dùng mà dựng thêm tầng chỉ để đủ bộ
năm chữ thì chỉ thêm chỗ hỏng.

> SOLID là công cụ để **test được và đổi được**, không phải danh sách phải tích đủ.

## Tầng màn ôn không biết gì về đồng bộ

Cách dễ: sau mỗi lần chấm, `ReviewScreen` gọi `sync()`. Nhưng thế là màn ôn phụ
thuộc vào đồng bộ.

Cách đã chọn: service **theo dõi dữ liệu** — đếm revlog chưa đẩy bằng `liveQuery`.
Số đó > 0 thì hẹn đẩy sau 3 giây (gom nhiều lần chấm liền nhau). Màn ôn chỉ ghi
revlog như trước giờ, không biết có đồng bộ hay không.

Thời điểm đáng chú ý nhất là **lúc rời app**: iOS sắp đóng băng trang, timer không
chạy nữa. Nên khi `visibilitychange` sang `hidden` thì đẩy ngay, không đợi.

## Đăng nhập trên iOS: không dùng magic link

Magic link (bấm link trong mail là vào) tiện trên máy tính. Trên iPhone, link mở
bằng **Safari** — mà Safari với app Home Screen là hai kho riêng. Đăng nhập xong ở
Safari, mở app vẫn chưa đăng nhập.

→ Email + mật khẩu, gõ ngay trong app đã cài.

Tài khoản chỉ có một, đăng ký tắt trên Supabase. Bảo vệ dữ liệu là **RLS** (Row
Level Security) trong database, không phải việc giấu key — publishable key được
thiết kế để nằm trong code frontend.

## Công cụ kiểm tra cũng có thể nói dối

Script `check-supabase` dò xem bảng đã tạo chưa bằng `select(…, { head: true })`.
Nó báo **"bảng revlog có"** khi chưa tạo bảng nào: request HEAD lên bảng không tồn
tại vẫn trả `204`.

Phát hiện được chỉ vì *biết trước* bảng chưa có. Cùng họ với DOMPurify thành hàm
rỗng ở [bài 07](07-cach-lam-viec.md): **chạy công cụ kiểm tra ở trạng thái biết
chắc là sai, xem nó có báo sai không.**

## Phạm vi: làm phần quan trọng nhất trước

Đồng bộ đợt này chỉ lo **tiến độ học**. Chưa đồng bộ:

- thao tác sửa (thẻ gõ tay, sửa note, tạm dừng, chuyển deck, xoá);
- bộ thẻ `.apkg` và media.

Lý do: tiến độ học là thứ **không tạo lại được** — mất là mất công nhiều tháng. Bộ
thẻ thì nhập lại được, và id thẻ lấy từ Anki nên nhập trên máy thứ hai thì revlog
tự khớp, tiến độ tự khôi phục.

## Đọc tiếp

- Code: [`src/sync/`](../../src/sync/), [`src/scheduler/replay.ts`](../../src/scheduler/replay.ts), [`supabase/schema.sql`](../../supabase/schema.sql)
- Test: `npm run test:sync`, `npm run check:supabase`
- Quay lại [mục lục](../README.md) · [nhật ký cột mốc](../MOC-MOC.md)
