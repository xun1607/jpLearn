# 6. Deploy và PWA

## Vì sao bắt buộc phải có HTTPS

Chạy `npm run dev -- --host` rồi mở `http://192.168.1.76:5173` trên iPhone cùng
wifi — cách test nhanh nhất, nên làm sớm.

Nhưng **không đủ** để cài app, vì service worker chỉ đăng ký được trong *secure
context*:

- `https://` — được
- `http://localhost` — được (ngoại lệ cho phát triển)
- `http://192.168.1.76` — **không**

Không service worker thì không offline, không precache. Vẫn "Add to Home Screen"
được, nhưng mở ra là màn trắng khi rời wifi.

→ Muốn có app thật thì phải deploy lên hosting có HTTPS.

## Chọn hosting

| | Ưu | Nhược |
| --- | --- | --- |
| **Vercel** | `npx vercel` là xong, không cần git, HTTPS sẵn | cần tài khoản |
| GitHub Pages | không cần tài khoản mới | phải push, phải chỉnh `base` trong vite.config |
| Cloudflare Pages | tương đương Vercel | cần tài khoản Cloudflare |

Chọn Vercel vì mục tiêu là *có app trong hôm nay*, và Vercel **tự nhận ra Vite**
rồi chạy `vite build`, xuất `dist/` — không cần cấu hình.

## Các bước dùng Vercel

### 1. Đăng nhập

```bash
npx vercel login
```

Mở trình duyệt, xác nhận mã hiện trên terminal (device flow của OAuth).

### 2. Liên kết thư mục với project

```bash
npx vercel link --yes --project cloneanki
```

> **Vấp**: chạy thẳng `npx vercel --prod` thì lỗi
> *"Project names … must be lowercase"* — Vercel lấy tên thư mục (`CloneAnki`) làm
> tên project, mà tên project bắt buộc chữ thường. Phải `link` với tên tự đặt trước.

Lệnh này tạo `.vercel/` (đã nằm trong `.gitignore`) lưu id project.

### 3. Deploy

```bash
npx vercel --prod --yes
```

Vercel nhận `dist/`, phát ra hai loại URL:

```
cloneanki-i4a32ea98-xun1607s-projects.vercel.app   ← URL riêng của lần deploy này
cloneanki.vercel.app                               ← URL production, cố định
```

Dùng URL production để cài vào điện thoại — nó luôn trỏ tới bản mới nhất.

> **Bẫy**: URL riêng của từng lần deploy bị **Deployment Protection** chặn, trả 302
> về trang đăng nhập Vercel. Chỉ URL production mới mở công khai. Kiểm tra bằng:
> ```bash
> curl -s -o /dev/null -w '%{http_code}' https://cloneanki.vercel.app/
> ```
> Ra `200` là được, ra `302` là đang xem nhầm URL.

### 4. SPA rewrite

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

App một trang, không có `/decks/123` thật trên server. Rewrite đẩy mọi đường dẫn về
`index.html`. Vercel **ưu tiên file tĩnh trước**, nên `/assets/index.js` vẫn ra
đúng file chứ không bị nuốt.

> **Vấp**: bản đầu viết regex `"/((?!assets/|.*\\..*).*)"` để loại trừ file. Heredoc
> trong shell nuốt mất một dấu `\`, thành `"\."` — không phải escape hợp lệ trong
> JSON, và Vercel báo *"Couldn't parse JSON file"*. Bài học: regex trong JSON là chỗ
> dễ hỏng; ở đây không cần regex vì file tĩnh đã được ưu tiên sẵn.

### Kiểm tra sau khi deploy

Đừng tin "deploy xong là chạy". Kiểm bằng `curl`, để ý **kiểu MIME**:

```bash
curl -s -o /dev/null -w 'HTTP %{http_code}  %{content_type}\n' \
  https://cloneanki.vercel.app/assets/sql-wasm-DfANybxk.wasm
# HTTP 200  application/wasm     ← phải đúng thế này
```

`.wasm` mà trả `text/html` thì `WebAssembly.instantiateStreaming` từ chối và **toàn
bộ chức năng nhập thẻ chết**, trong khi app nhìn vẫn bình thường.

## PWA cần đúng ba thứ

### 1. Manifest

```ts
manifest: {
  name: 'Thẻ — học từ vựng',
  short_name: 'Thẻ',          // tên dưới icon, phải ngắn
  display: 'standalone',      // không có thanh địa chỉ
  start_url: '/',
  background_color: '#f8fafc',
  theme_color: '#0f172a',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}
```

iOS còn cần thẻ meta riêng trong `index.html`:

```html
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Thẻ" />
```

Safari **không đọc `icons` trong manifest** cho icon Home Screen — nó đọc
`apple-touch-icon`. Thiếu là iOS chụp màn hình trang làm icon, nhìn rất tệ.

### 2. Service worker

Hai chế độ của `vite-plugin-pwa`:

| | `generateSW` | `injectManifest` |
| --- | --- | --- |
| Công sức | không viết dòng nào | tự viết `sw.ts` |
| Tuỳ biến | chỉ qua cấu hình | tuỳ ý |

Dự án này bắt đầu bằng `generateSW`, sau **phải đổi sang `injectManifest`** khi cần
phục vụ `/media/*` từ IndexedDB — `runtimeCaching` của workbox chỉ biết cache mạng,
không đọc được IndexedDB.

```ts
VitePWA({
  registerType: 'autoUpdate',
  strategies: 'injectManifest',
  srcDir: 'src',
  filename: 'sw.ts',
  injectManifest: {
    globPatterns: ['**/*.{js,css,html,png,svg,wasm}'],
    maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
  },
})
```

`wasm` phải có trong `globPatterns`. `sql-wasm.wasm` nặng 658KB nên cũng phải nâng
`maximumFileSizeToCacheInBytes` — mặc định 2MB thì vừa, nhưng nâng lên cho chắc.

> **Vấp**: `workbox-build` tìm **đúng chuỗi** `self.__WB_MANIFEST` trong file đã
> bundle. Viết `const sw = self as …` rồi `sw.__WB_MANIFEST` thì bundler nội suy
> biến đi mất, build chết với *"Unable to find a place to inject the manifest"*.
> Phải giữ nguyên chữ `self.__WB_MANIFEST`.

### 3. Xin quyền lưu trữ bền

```ts
void navigator.storage?.persist?.()
```

Không gọi thì iOS coi dữ liệu là "có thể bỏ" và **dọn sạch IndexedDB khi thiếu chỗ**.
Với app học thẻ thì đó là mất toàn bộ tiến độ.

## Service worker phục vụ media

Đây là phần thú vị nhất: service worker không nhất thiết phải cache mạng, nó có thể
**tự sinh ra response**.

```ts
registerRoute(
  ({ url }) => url.origin === sw.location.origin && url.pathname.startsWith('/media/'),
  ({ request, url }) => serveMedia(decodeURIComponent(url.pathname.slice(7)), request),
)
```

Thứ tự đăng ký quan trọng: **media phải trước `NavigationRoute`**, không thì SPA
fallback nuốt mất.

### Đọc IndexedDB bằng API thô, không qua Dexie

```ts
const open = indexedDB.open(DB_NAME)   // KHÔNG kèm số version
```

Cố ý bỏ số version. Nếu ghi `indexedDB.open('flashcards', 1)` mà luồng chính đã lên
version 2 thì service worker sẽ **kích hoạt nâng cấp ngược** — hỏng database.

Không kèm version nghĩa là "mở version hiện có, đừng đụng gì". Nâng cấp schema là
việc của luồng chính; service worker chỉ đọc.

### Bẫy `Range` của Safari

```ts
// Safari luôn hỏi Range cho audio; trả nguyên 200 thì không tua được
// và có bản còn không phát.
if (range) {
  return new Response(blob.slice(start, end + 1, type), {
    status: 206,
    headers: {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      …
    },
  })
}
```

Safari gửi `Range: bytes=0-1` trước để dò kích thước file, rồi mới xin phần còn lại.
Trả 200 kèm cả file cho request đó thì Safari coi như server không hỗ trợ seek — có
bản im luôn không phát.

> **Bài học**: khi tự sinh response trong service worker, bạn đang đóng vai server.
> Phải tuân thủ giao thức HTTP cho đầy đủ, kể cả phần tưởng như không liên quan.

## Cập nhật app đã cài

```ts
registerType: 'autoUpdate'
```

Service worker mới tự cài và chiếm quyền. Nhưng trên iOS, **người dùng phải mở lại
app** (hoặc kéo xuống reload) thì mới nhận. Không có cơ chế đẩy bản mới.

Đáng nhớ khi sửa lỗi: *"đã deploy rồi mà máy tôi vẫn lỗi cũ"* thường chỉ là service
worker chưa kịp thay.

## Kiểm tra trước khi tin là xong

```bash
# 1. precache có đủ wasm và worker không
grep -oE '"(assets/[^"]+)"' dist/sw.js | sort -u

# 2. mọi tài nguyên trả đúng kiểu MIME
for p in / /manifest.webmanifest /sw.js /icon-192.png; do
  curl -s -o /dev/null -w "$p  %{http_code}  %{content_type}\n" https://cloneanki.vercel.app$p
done
```

## Đọc tiếp

- [07 — Cách làm việc](07-cach-lam-viec.md)
- Code: [`src/sw.ts`](../../src/sw.ts), [`vite.config.ts`](../../vite.config.ts), [`vercel.json`](../../vercel.json)
