import { supabase } from './supabase'

/**
 * Đăng nhập một tài khoản duy nhất — lệch có duyệt so với CLAUDE.md §10
 * ("không làm đăng nhập"). Mục đích của §10 là không làm hệ nhiều người dùng;
 * ở đây chỉ có tài khoản của tác giả, đăng ký đã tắt trên Supabase. Không có
 * đăng nhập thì RLS không biết revlog là của ai để chặn người lạ.
 */

export interface Account {
  id: string
  email: string
}

export async function currentAccount(): Promise<Account | null> {
  // getSession đọc phiên đã lưu, không cần mạng — mở app offline vẫn biết
  // đang đăng nhập ai để hiện đúng trạng thái.
  const { data } = await supabase().auth.getSession()
  const user = data.session?.user
  return user ? { id: user.id, email: user.email ?? '' } : null
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw new Error(explainAuthError(error.message))
}

export async function signOut(): Promise<void> {
  // scope local: chỉ đăng xuất máy này, máy kia vẫn đồng bộ bình thường.
  await supabase().auth.signOut({ scope: 'local' })
}

export function onAccountChange(listener: (account: Account | null) => void): () => void {
  const { data } = supabase().auth.onAuthStateChange((_event, session) => {
    const user = session?.user
    listener(user ? { id: user.id, email: user.email ?? '' } : null)
  })
  return () => data.subscription.unsubscribe()
}

function explainAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'Sai email hoặc mật khẩu.'
  if (/email not confirmed/i.test(message)) {
    return 'Email chưa xác nhận. Trên Supabase, tạo user với tuỳ chọn "Auto Confirm User".'
  }
  if (/fetch|network/i.test(message)) return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'
  return message
}
