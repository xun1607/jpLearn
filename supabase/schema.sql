-- Đồng bộ iPhone ↔ iPad: bảng revlog trên Supabase.
--
-- Cách chạy: Supabase dashboard → SQL Editor → New query → dán cả file → Run.
-- Chạy lại nhiều lần vẫn an toàn (if not exists / drop policy if exists).
--
-- Server chỉ giữ LỊCH SỬ ÔN, không giữ trạng thái thẻ. Mỗi máy kéo revlog về
-- rồi tự phát lại bằng ts-fsrs để tính stability / difficulty / due.

create table if not exists public.revlog (
  -- Khoá toàn cục do máy sinh ra. Đẩy cùng một dòng hai lần thì lần sau bị bỏ qua.
  uid            uuid primary key,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id        bigint not null,
  rating         smallint not null check (rating between 1 and 4),
  -- Trạng thái TRƯỚC khi ôn (0 = new). Màn ôn dùng nó để đếm hạn mức thẻ mới.
  state          smallint not null,
  elapsed_days   double precision not null default 0,
  scheduled_days double precision not null default 0,
  reviewed_at    timestamptz not null,
  -- Con trỏ kéo về: máy nhớ "đã lấy tới seq nào", lần sau chỉ hỏi phần mới hơn.
  -- Dùng seq của server chứ không dùng giờ của máy, vì giờ hai máy có thể lệch.
  seq            bigint generated always as identity,
  created_at     timestamptz not null default now()
);

create index if not exists revlog_user_seq on public.revlog (user_id, seq);

alter table public.revlog enable row level security;

-- Chỉ cho ĐỌC và THÊM. Không có policy update/delete nghĩa là server từ chối
-- sửa hay xoá — revlog append-only được ép ở tầng database chứ không chỉ
-- trông vào code app.
drop policy if exists "revlog: đọc của mình" on public.revlog;
create policy "revlog: đọc của mình" on public.revlog
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "revlog: thêm của mình" on public.revlog;
create policy "revlog: thêm của mình" on public.revlog
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Project mới có thể không tự mở bảng cho Data API — cấp quyền tường minh.
grant select, insert on public.revlog to authenticated;
revoke all on public.revlog from anon;
