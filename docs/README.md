# Tài liệu dự án

| Tài liệu | Nội dung |
| -------- | -------- |
| [MOC-MOC.md](MOC-MOC.md) | Nhật ký cột mốc: làm gì, ngày nào, vì sao |
| [hoc/](hoc/) | Giải thích cách nghĩ ra từng phần — đọc để học lại |

Ba file gốc nằm ngoài thư mục này:

- [`../CLAUDE.md`](../CLAUDE.md) — các quyết định đã chốt, đọc trước khi sửa gì.
- [`../README.md`](../README.md) — lệnh chạy, phạm vi đã làm.
- `git log` — mỗi commit ghi lý do, không chỉ ghi việc.

## Thứ tự đọc trong `hoc/`

Bảy bài, đọc theo số. Mỗi bài trả lời "vì sao làm thế" chứ không phải "làm thế nào",
vì phần "làm thế nào" đã nằm trong code rồi.

1. [Từ ý tưởng tới kiến trúc](hoc/01-tu-y-tuong-den-kien-truc.md) — vì sao PWA, vì sao bám schema Anki
2. [Thuật toán lặp lại](hoc/02-thuat-toan-lap-lai.md) — FSRS, hàng đợi, chôn thẻ anh em
3. [Đọc file `.apkg`](hoc/03-doc-file-apkg.md) — zip, SQLite, zstd, protobuf, ba cái bẫy
4. [Render thẻ](hoc/04-render-the.md) — template engine, Shadow DOM, sanitize
5. [Giao diện cho điện thoại](hoc/05-giao-dien-mobile.md) — safe area, `100vh`, tầm ngón cái
6. [Deploy và PWA](hoc/06-deploy-va-pwa.md) — Vercel, service worker, HTTPS
7. [Cách làm việc](hoc/07-cach-lam-viec.md) — test trước khi nối UI, commit từng bước
