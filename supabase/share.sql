-- 🩺 케이스 같이 보기 (친구 공유) — Supabase 설정
-- Supabase 대시보드 → SQL Editor → New query 에 전체를 붙여넣고 Run.
-- ⚠️ 맨 아래 초대코드('여기에-초대코드')를 바꾼 뒤 실행할 것. 이 저장소는 공개라 실제 코드는 여기 적지 않는다.

-- 1) 케이스에 '공유' 표시와 분류 칸 추가
alter table public.cases add column if not exists shared boolean not null default false;
alter table public.cases add column if not exists cls text;

-- 2) 공유 모임 회원 (초대코드로 들어온 사람)
create table if not exists public.share_members (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  nickname   text not null check (char_length(nickname) between 1 and 20),
  created_at timestamptz not null default now()
);
alter table public.share_members enable row level security;

-- 초대코드 보관 (정책이 없어서 API로는 아무도 못 읽음)
create table if not exists public.share_config (
  id          int primary key default 1 check (id = 1),
  invite_code text not null
);
alter table public.share_config enable row level security;

create or replace function public.is_share_member(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.share_members where user_id = uid)
$$;

-- 초대코드 확인 후 회원 등록 (닉네임 바꿀 때도 같은 함수)
create or replace function public.join_share(p_code text, p_nick text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if char_length(trim(coalesce(p_nick, ''))) = 0 then raise exception 'nickname required'; end if;
  if not public.is_share_member() and not exists (select 1 from public.share_config where invite_code = p_code) then
    return false;
  end if;
  insert into public.share_members (user_id, nickname) values (auth.uid(), left(trim(p_nick), 20))
  on conflict (user_id) do update set nickname = excluded.nickname;
  return true;
end $$;
revoke all on function public.join_share(text, text) from public, anon;
grant execute on function public.join_share(text, text) to authenticated;

drop policy if exists "members read members" on public.share_members;
create policy "members read members" on public.share_members for select using (public.is_share_member());
drop policy if exists "leave share" on public.share_members;
create policy "leave share" on public.share_members for delete using (user_id = auth.uid());

-- 3) 공유한 케이스는 회원끼리 읽기 가능 (본인 케이스 정책은 그대로)
drop policy if exists "shared cases read" on public.cases;
create policy "shared cases read" on public.cases for select
  using (shared and public.is_share_member() and public.is_share_member(user_id));

-- 4) 공유한 케이스의 사진·동영상만 회원이 열 수 있게
drop policy if exists "shared case media read" on storage.objects;
create policy "shared case media read" on storage.objects for select
  using (bucket_id = 'cases' and public.is_share_member() and exists (
    select 1 from public.cases c where c.shared and storage.objects.name = any (c.images) and public.is_share_member(c.user_id)));

-- 5) 댓글 (판독 토론)
create table if not exists public.case_comments (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.cases(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists case_comments_case on public.case_comments (case_id, created_at);
alter table public.case_comments enable row level security;
drop policy if exists "read comments" on public.case_comments;
create policy "read comments" on public.case_comments for select
  using (public.is_share_member() and exists (select 1 from public.cases c where c.id = case_id and c.shared));
drop policy if exists "write comments" on public.case_comments;
create policy "write comments" on public.case_comments for insert
  with check (user_id = auth.uid() and public.is_share_member()
    and exists (select 1 from public.cases c where c.id = case_id and c.shared));
drop policy if exists "delete comments" on public.case_comments;
create policy "delete comments" on public.case_comments for delete
  using (user_id = auth.uid() or exists (select 1 from public.cases c where c.id = case_id and c.user_id = auth.uid()));

-- 7) ❤️ 반응 (케이스·댓글에 이모지 누르기)
create table if not exists public.share_reactions (
  target_id  uuid not null,
  kind       text not null check (kind in ('case', 'comment')),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  emoji      text not null check (char_length(emoji) <= 16),
  created_at timestamptz not null default now(),
  primary key (target_id, user_id, emoji)
);
alter table public.share_reactions enable row level security;
drop policy if exists "read reactions" on public.share_reactions;
create policy "read reactions" on public.share_reactions for select using (public.is_share_member());
drop policy if exists "add reactions" on public.share_reactions;
create policy "add reactions" on public.share_reactions for insert with check (user_id = auth.uid() and public.is_share_member());
drop policy if exists "remove reactions" on public.share_reactions;
create policy "remove reactions" on public.share_reactions for delete using (user_id = auth.uid());

-- 6) 초대코드 (나중에 바꿀 때도 이 줄만 다시 실행)
insert into public.share_config (id, invite_code) values (1, '여기에-초대코드')
on conflict (id) do update set invite_code = excluded.invite_code;
