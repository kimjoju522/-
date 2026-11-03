-- 비플페이 식당 지도 스키마
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

-- 상권(구획): 소상공인시장진흥공단 상권번호(trarNo)를 그대로 id로 사용
create table if not exists zones (
  id          text primary key,
  name        text not null,
  sido        text,
  sigungu     text,
  polygon     jsonb not null,          -- [[[lng, lat], ...], ...] 링 배열
  fetched_at  timestamptz not null default now()
);

-- 식당: 상가업소번호(bizesId)를 id로 사용
create table if not exists stores (
  id              text primary key,
  zone_id         text not null references zones(id) on delete cascade,
  name            text not null,
  branch          text,
  category        text,                -- 중분류 (예: 한식)
  category_detail text,                -- 소분류 (예: 국밥)
  road_address    text,
  jibun_address   text,
  lat             double precision not null,
  lng             double precision not null,
  pay_status      text check (pay_status in ('yes', 'no')),
  pay_updated_at  timestamptz
);
create index if not exists stores_zone_id_idx on stores(zone_id);

-- 사용자 제보 기록: 가장 최근 제보가 식당의 상태가 됨
create table if not exists reports (
  id          bigint generated always as identity primary key,
  store_id    text not null references stores(id) on delete cascade,
  status      text not null check (status in ('yes', 'no')),
  created_at  timestamptz not null default now()
);
create index if not exists reports_store_id_idx on reports(store_id);

-- 제보가 들어오면 stores.pay_status 를 갱신
create or replace function apply_report() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update stores
     set pay_status = new.status, pay_updated_at = new.created_at
   where id = new.store_id;
  return new;
end $$;

drop trigger if exists reports_apply on reports;
create trigger reports_apply after insert on reports
  for each row execute function apply_report();

-- 권한: 누구나 읽기 가능, 제보 추가만 가능. 상권·식당 쓰기는 서버(service role)만.
alter table zones   enable row level security;
alter table stores  enable row level security;
alter table reports enable row level security;

drop policy if exists "zones read"     on zones;
drop policy if exists "stores read"    on stores;
drop policy if exists "reports read"   on reports;
drop policy if exists "reports insert" on reports;
create policy "zones read"     on zones   for select using (true);
create policy "stores read"    on stores  for select using (true);
create policy "reports read"   on reports for select using (true);
create policy "reports insert" on reports for insert with check (status in ('yes', 'no'));

-- 다른 사용자의 제보가 지도에 실시간 반영되도록
alter publication supabase_realtime add table stores;
