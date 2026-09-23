/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

/**
 * §7: service worker bắt request tới `/media/*` và trả blob từ IndexedDB.
 * Nhờ vậy thẻ gốc `<img src="neko.jpg">` chỉ cần đổi đường dẫn là chạy, khỏi
 * phải quản lý vòng đời URL.createObjectURL.
 *
 * Đọc IndexedDB bằng API thô chứ không qua Dexie: service worker phải nhẹ, và
 * quan trọng hơn là nó KHÔNG được tự nâng cấp schema — nâng cấp là việc của
 * luồng chính, worker chỉ đọc.
 */

declare global {
  // workbox-build tìm đúng chuỗi `self.__WB_MANIFEST` trong file đã bundle để
  // thay bằng danh sách precache — không được gán self qua biến trung gian,
  // bundler nội suy đi là build hỏng.
  var __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

const sw = self as unknown as ServiceWorkerGlobalScope

const DB_NAME = 'flashcards'
const MEDIA_STORE = 'media'
const MEDIA_PREFIX = '/media/'

sw.skipWaiting()
clientsClaim()

// Media phải đứng trước NavigationRoute, không thì SPA fallback nuốt mất.
registerRoute(
  ({ url }) => url.origin === sw.location.origin && url.pathname.startsWith(MEDIA_PREFIX),
  ({ request, url }) => serveMedia(decodeURIComponent(url.pathname.slice(MEDIA_PREFIX.length)), request),
)

precacheAndRoute(self.__WB_MANIFEST)

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/media\//],
  }),
)

// ---------------------------------------------------------------- media

async function serveMedia(name: string, request: Request): Promise<Response> {
  try {
    const blob = await readMedia(name)
    if (!blob) return new Response(null, { status: 404, statusText: 'Không có media này' })

    const type = blob.type || guessType(name)
    const range = request.headers.get('Range')

    // Safari luôn hỏi Range cho audio; trả nguyên 200 thì không tua được và
    // có bản còn không phát. Phải cắt blob và trả 206.
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range)
      if (match) {
        const size = blob.size
        const start = match[1] === '' ? Math.max(0, size - Number(match[2])) : Number(match[1])
        const end = match[2] === '' || match[1] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
        if (start >= size || start > end) {
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${size}` },
          })
        }
        return new Response(blob.slice(start, end + 1, type), {
          status: 206,
          headers: {
            'Content-Type': type,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store',
          },
        })
      }
    }

    return new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Length': String(blob.size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return new Response(String(err), { status: 500 })
  }
}

function readMedia(name: string): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    // Mở không kèm version: nếu DB chưa tồn tại thì chỉ tạo bản rỗng, không
    // đụng tới schema mà luồng chính quản lý.
    const open = indexedDB.open(DB_NAME)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        db.close()
        resolve(null)
        return
      }
      const request = db.transaction(MEDIA_STORE, 'readonly').objectStore(MEDIA_STORE).get(name)
      request.onerror = () => {
        db.close()
        reject(request.error)
      }
      request.onsuccess = () => {
        const row = request.result as { blob?: Blob } | undefined
        db.close()
        resolve(row?.blob instanceof Blob ? row.blob : null)
      }
    }
  })
}

const TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
}

function guessType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return TYPES[ext] ?? 'application/octet-stream'
}
