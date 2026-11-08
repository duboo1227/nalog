-- 규나의 출근 일지 — Supabase 설정
-- Supabase 대시보드 → SQL Editor → New query 에 전체를 붙여넣고 Run.

-- 1) 하루 기록 (뉴스 메모, 일기, 독서, 공부)
create table if not exists public.days (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date       date not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);
alter table public.days enable row level security;
drop policy if exists "own days" on public.days;
create policy "own days" on public.days
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2) 케이스 모음
create table if not exists public.cases (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date       date not null default current_date,
  region     text,
  title      text,
  findings   text,
  impression text,
  memo       text,
  tags       text[] not null default '{}',
  images     text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.cases enable row level security;
drop policy if exists "own cases" on public.cases;
create policy "own cases" on public.cases
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3) 케이스 이미지 저장소 (비공개, 본인 폴더만 접근)
insert into storage.buckets (id, name, public)
values ('cases', 'cases', false)
on conflict (id) do nothing;

drop policy if exists "case images select" on storage.objects;
drop policy if exists "case images insert" on storage.objects;
drop policy if exists "case images update" on storage.objects;
drop policy if exists "case images delete" on storage.objects;
create policy "case images select" on storage.objects for select
  using (bucket_id = 'cases' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "case images insert" on storage.objects for insert
  with check (bucket_id = 'cases' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "case images update" on storage.objects for update
  using (bucket_id = 'cases' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "case images delete" on storage.objects for delete
  using (bucket_id = 'cases' and (storage.foldername(name))[1] = auth.uid()::text);
