/**
 * Kiểm tra phía Supabase đã cài đúng chưa — chạy trước khi thử trên điện thoại.
 *
 *   npm run check:supabase
 *   SUPABASE_EMAIL=… SUPABASE_PASSWORD=… npm run check:supabase   # kiểm cả đăng nhập
 *
 * Chỉ ĐỌC, không ghi gì lên server: revlog là append-only, ghi thử một dòng
 * là nó nằm đó vĩnh viễn.
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL ?? 'https://mcdqjcrhlathzwxzmbin.supabase.co'
const KEY = process.env.VITE_SUPABASE_KEY ?? 'sb_publishable_89wBzewNIS4bfKYMdciE9A_A6H5n2f3'

let problems = 0
const ok = (msg) => console.log(`  ✓ ${msg}`)
const bad = (msg, fix) => {
  problems++
  console.log(`  ✗ ${msg}\n      → ${fix}`)
}

console.log(`\nSupabase: ${URL}\n`)

// 1. Đăng ký phải TẮT: app chỉ có một người dùng, ai biết URL cũng không được tự tạo tài khoản.
const settings = await fetch(`${URL}/auth/v1/settings`, { headers: { apikey: KEY } })
  .then((r) => r.json())
  .catch((err) => ({ error: String(err) }))
if (settings.error) bad(`không gọi được server: ${settings.error}`, 'kiểm tra mạng / URL')
else if (settings.disable_signup) ok('đăng ký tài khoản mới đã tắt')
else
  bad(
    'đăng ký tài khoản mới đang MỞ',
    'Authentication → Sign In / Providers → tắt "Allow new users to sign up"',
  )

// 2. Bảng revlog phải tồn tại, và người chưa đăng nhập không đọc được gì.
const anon = createClient(URL, KEY, { auth: { persistSession: false } })
// KHÔNG dùng { head: true }: request HEAD lên bảng không tồn tại vẫn trả 204
// "thành công" — chính script này từng báo "bảng có" khi chưa tạo bảng nào.
const probe = await anon.from('revlog').select('uid').limit(1)
if (probe.error?.code === 'PGRST205' || /could not find the table/i.test(probe.error?.message ?? '')) {
  bad('chưa có bảng revlog', 'SQL Editor → dán supabase/schema.sql → Run')
} else if (probe.error && !/permission denied/i.test(probe.error.message)) {
  bad(`lỗi lạ khi đọc bảng: ${probe.error.message}`, 'xem lại supabase/schema.sql')
} else if (!probe.error && probe.data.length > 0) {
  bad('người CHƯA đăng nhập đọc được revlog', 'RLS chưa bật — chạy lại supabase/schema.sql')
} else {
  ok('bảng revlog có, người lạ không đọc được')
}

// 3. Tuỳ chọn: đăng nhập thật và đọc revlog của chính mình.
const email = process.env.SUPABASE_EMAIL
const password = process.env.SUPABASE_PASSWORD
if (email && password) {
  const me = createClient(URL, KEY, { auth: { persistSession: false } })
  const { error } = await me.auth.signInWithPassword({ email, password })
  if (error) bad(`đăng nhập thất bại: ${error.message}`, 'kiểm tra user, nhớ chọn Auto Confirm')
  else {
    ok(`đăng nhập được: ${email}`)
    const mine = await me.from('revlog').select('uid', { count: 'exact' }).limit(1)
    if (mine.error) bad(`đọc revlog của mình lỗi: ${mine.error.message}`, 'xem lại grant/policy')
    else ok(`đọc được revlog của mình: ${mine.count ?? 0} dòng`)
  }
} else {
  console.log('  · bỏ qua kiểm tra đăng nhập (đặt SUPABASE_EMAIL / SUPABASE_PASSWORD để kiểm)')
}

console.log(problems ? `\n${problems} việc cần làm ở trên.` : '\nPhía Supabase đã sẵn sàng.')
process.exitCode = problems ? 1 : 0
