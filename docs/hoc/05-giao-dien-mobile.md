# 5. Giao diện cho điện thoại

## Thiết kế màn chiếm 95% thời gian trước

Nguyên tắc từ CLAUDE.md §8: *"Màn ôn thẻ là màn chiếm 95% thời gian sử dụng —
thiết kế nó trước, các màn khác tính sau."*

Nghe hiển nhiên nhưng trái với bản năng. Bản năng bảo làm theo thứ tự kiến trúc:
đăng nhập → danh sách → chi tiết. Kết quả là màn quan trọng nhất được làm cuối cùng,
lúc đã hết sức.

Trong dự án này, màn ôn được làm ở commit đầu tiên. Danh sách deck chỉ là một
`<ul>` cho tới khi cần nút xoá.

## Một breakpoint duy nhất

```
< 768px  → một cột
≥ 768px  → sidebar deck + nội dung
```

Chỉ một. Không `sm/md/lg/xl`.

Lý do: app này chạy trên **iPhone và iPad**, hai kích thước. Mỗi breakpoint thêm vào
là một tổ hợp phải tự tay kiểm tra. Với app cá nhân thì 4 breakpoint không làm giao
diện tốt hơn — chỉ làm tăng số chỗ có thể vỡ.

Trên thực tế, cách cài còn đơn giản hơn: dùng `max-w-2xl mx-auto` cho vùng nội dung.

```tsx
<div className="flex-1 overflow-y-auto px-4 py-6">
  <div className="mx-auto max-w-2xl">…</div>
</div>
```

Điện thoại: chiếm hết bề ngang. iPad: nội dung co lại, căn giữa. Không cần media
query nào cả.

> **Cách nghĩ**: giới hạn bề rộng + căn giữa giải quyết phần lớn nhu cầu "responsive"
> mà không cần breakpoint. Breakpoint chỉ cần khi **bố cục đổi hẳn**, không phải khi
> kích thước đổi.

## Ba cái bẫy của Safari iOS

### Bẫy 1 — `100vh` sai

`100vh` trên Safari iOS **không phải** chiều cao vùng nhìn thấy. Nó là chiều cao khi
thanh địa chỉ đã ẩn. Thanh địa chỉ hiện ra thì phần dưới trang bị che mất.

Với app flashcard, phần bị che chính là **hàng nút đánh giá**.

Cách xử lý — dựng cột flex, vùng thẻ chiếm phần còn lại:

```tsx
<div className="flex h-full flex-col">
  <Header />                                       {/* cao tự nhiên */}
  <div className="flex-1 overflow-y-auto">…</div>  {/* ăn hết phần giữa */}
  <AnswerBar />                                    {/* cao tự nhiên */}
</div>
```

kèm chuỗi `height: 100%` từ gốc:

```css
html, body, #root { height: 100% }
```

`100%` neo vào phần tử cha thật, không neo vào con số mà trình duyệt đoán. Ổn định
trong mọi trạng thái thanh địa chỉ.

> `100dvh` (dynamic viewport height) là cách hiện đại, nhưng chuỗi `height: 100%` +
> flex vẫn chắc hơn vì không phụ thuộc phiên bản Safari.

### Bẫy 2 — safe area, thứ dễ quên nhất

Đây là bẫy **chỉ xuất hiện sau khi cài vào Home Screen**, không thấy khi test trong
tab Safari.

iPhone đời mới có thanh gạt home ở đáy màn hình. Chạy trong tab thì Safari chừa chỗ
sẵn. Chạy standalone thì app chiếm hết màn hình → **hàng nút bị thanh gạt ăn mất**.

Hai phần, thiếu phần nào cũng hỏng:

**Phần 1** — cho phép tràn ra vùng safe area:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

Không có `viewport-fit=cover` thì `env(safe-area-inset-*)` luôn trả về `0`.

**Phần 2** — cộng inset vào padding:

```css
.pb-safe {
  padding-bottom: calc(0.625rem + env(safe-area-inset-bottom, 0px));
}
```

Chú ý giá trị dự phòng `0px` trong `env()`. Trình duyệt desktop không hiểu
`safe-area-inset-bottom`; không có dự phòng thì cả biểu thức `calc()` thành không
hợp lệ và padding biến mất.

### Bẫy 3 — kho lưu trữ tách đôi

Không phải lỗi CSS nhưng cắn đau nhất:

> **App đã cài vào Home Screen dùng kho IndexedDB RIÊNG, tách hẳn khỏi Safari.**

Nhập `.apkg` trong tab Safari rồi mở app từ icon → **trống trơn**. Không lỗi, không
thông báo, chỉ là danh sách rỗng.

Không có cách nào khắc phục bằng code. Chỉ có cách nhớ: **luôn nhập bộ thẻ từ bên
trong app đã cài.** Ghi rõ trong README để 3 tháng nữa không phải tự hỏi vì sao.

## Đặt nút trong tầm ngón cái

```
┌─────────────────┐
│  deck   còn 12  │ ← thông tin, ít chạm
├─────────────────┤
│                 │
│       漢字       │ ← vùng đọc, chạm đâu cũng lật
│                 │
├─────────────────┤
│ Lại  Khó Được Dễ│ ← vùng bấm, trong tầm ngón cái
└─────────────────┘
```

Tay cầm điện thoại thì ngón cái quét được **nửa dưới màn hình**. Nút quan trọng nhất
— và bấm nhiều nhất — phải nằm ở đó.

Trên iPad, thanh nút co lại và căn giữa vì tay giữ hai bên.

```tsx
<div className="mx-auto flex max-w-2xl gap-2">
```

## Hiện khoảng thời gian dưới mỗi nút

```
  Lại        Khó        Được       Dễ
  1 phút     6 ngày     11 ngày    24 ngày
```

Chi tiết nhỏ nhất nhưng đổi hẳn trải nghiệm. Không có nó thì "Khó" và "Được" chỉ là
hai từ mơ hồ; có nó thì bạn chọn được theo thông tin thật.

Cài bằng `scheduler.repeat()` — xem trước cả 4 lựa chọn mà không áp dụng lựa chọn nào.

Định dạng bằng tiếng Việt, dùng dấu phẩy thập phân:

```ts
function round1(n: number): string {
  return n.toFixed(1).replace('.0', '').replace('.', ',')
}
```

## Phím tắt vẫn đáng làm cho app điện thoại

`1 2 3 4` để chấm điểm, `Space` để lật thẻ. Điện thoại không có bàn phím, nhưng
**iPad có bàn phím rời** thì tốc độ ôn tăng gấp đôi. Và lúc phát triển trên laptop
thì bạn chính là người hưởng lợi.

Chi phí: khoảng 15 dòng.

```ts
if (e.key === 'Enter' || (e.key === ' ' && !typing)) {
  e.preventDefault()
  if (showAnswer) void rate(3 as Grade)
  else reveal()
}
```

Chú ý `!typing` — chi tiết này chỉ lộ ra sau khi làm `{{type:}}`. Đang gõ đáp án mà
`Space` lật thẻ thì không gõ nổi từ nào có dấu cách. Xem [bài 04](04-render-the.md)
phần `isTypingTarget()`.

## Vài chi tiết nhỏ dễ bỏ sót

**Chặn kéo nảy (rubber-band)** — không thì kéo thẻ thấy cả trang nảy lên xuống:

```css
body { overscroll-behavior: none; }
```

**Bỏ ô sáng khi chạm** — mặc định của Safari nhìn rất "web":

```css
body { -webkit-tap-highlight-color: transparent; }
```

**Dùng `active:` thay `hover:`** — điện thoại không có hover, `hover:` sẽ kẹt lại
sau khi chạm:

```tsx
className="… active:bg-slate-100"
```

**Cỡ chữ ô nhập ≥ 16px** — nhỏ hơn là Safari iOS tự phóng to trang khi focus:

```css
.typeans { font-size: 1rem; }
```

**Ảnh không tràn** — bộ thẻ tải về chứa ảnh kích thước bất kỳ:

```css
img, video { max-width: 100%; height: auto; }
```

## Hộp thoại xác nhận: dùng tấm trượt từ đáy

Khi làm nút xoá bộ thẻ, `window.confirm()` là cách nhanh nhất. Nhưng nó:

- Nhìn như hộp thoại của trình duyệt, phá cảm giác "đang dùng app".
- Không hiện được số liệu (bao nhiêu thẻ sẽ mất).

Tấm trượt từ đáy tốn thêm ~30 dòng mà giải quyết cả hai:

```tsx
<div className="fixed inset-0 z-10 flex items-end bg-black/40" onClick={onCancel}>
  <div className="pb-safe w-full rounded-t-2xl bg-white px-5 pt-5"
       onClick={(e) => e.stopPropagation()}>
```

`items-end` đẩy xuống đáy — vừa tầm ngón cái. Bấm nền tối thì đóng, `stopPropagation`
để bấm trong tấm không đóng nhầm. Và vẫn phải `pb-safe`.

## Đọc tiếp

- [06 — Deploy và PWA](06-deploy-va-pwa.md)
- Code: [`src/index.css`](../../src/index.css), [`src/features/review/AnswerBar.tsx`](../../src/features/review/AnswerBar.tsx)
