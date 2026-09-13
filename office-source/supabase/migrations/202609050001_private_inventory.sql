-- Local migration source only. Apply to the existing shop project after review.
-- No anonymous access, shared-password RPCs, or SECURITY DEFINER functions.
begin;
create table if not exists public.inventory_members (
  user_id uuid primary key references auth.users(id),
  shop_id uuid not null,
  role text not null check (role in ('owner','device'))
);
create unique index if not exists inventory_one_device_per_shop on public.inventory_members(shop_id) where role='device';
create table if not exists public.inventory_snapshots (
  shop_id uuid primary key,
  device_instance uuid not null,
  revision bigint not null default 0 check(revision>=0),
  snapshot jsonb not null,
  synced_at timestamptz not null default now()
);
create table if not exists public.inventory_requests (
  id uuid primary key,
  shop_id uuid not null,
  created_by uuid not null references auth.users(id),
  type text not null check(type in ('product.save','stock.receive','stock.count','supplier.save','purchase.receive')),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=262144),
  status text not null default 'pending' check(status in ('pending','applied','rejected')),
  message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists inventory_requests_pending on public.inventory_requests(shop_id,status,created_at);
alter table public.inventory_members enable row level security;
alter table public.inventory_snapshots enable row level security;
alter table public.inventory_requests enable row level security;
revoke all on public.inventory_members,public.inventory_snapshots,public.inventory_requests from public,anon,authenticated;
grant select on public.inventory_members to authenticated;
grant select,insert,update on public.inventory_snapshots to authenticated;
grant select,insert on public.inventory_requests to authenticated;
grant update(status,message,completed_at) on public.inventory_requests to authenticated;
create policy inventory_self_membership on public.inventory_members for select to authenticated using(user_id=(select auth.uid()));
create policy inventory_shop_read on public.inventory_snapshots for select to authenticated using(shop_id in (select shop_id from public.inventory_members where user_id=(select auth.uid())));
create policy inventory_device_insert on public.inventory_snapshots for insert to authenticated with check(shop_id in (select shop_id from public.inventory_members where user_id=(select auth.uid()) and role in ('owner','device')));
create policy inventory_device_update on public.inventory_snapshots for update to authenticated using(shop_id in (select shop_id from public.inventory_members where user_id=(select auth.uid()) and role in ('owner','device'))) with check(shop_id in (select shop_id from public.inventory_members where user_id=(select auth.uid()) and role in ('owner','device')));
create policy inventory_requests_read on public.inventory_requests for select to authenticated using(shop_id in (select shop_id from public.inventory_members where user_id=(select auth.uid())));
create policy inventory_owner_request on public.inventory_requests for insert to authenticated with check(created_by=(select auth.uid()) and status='pending' and completed_at is null and message is null and shop_id in (select shop_id from public.inventory_members where user_id=(select auth.uid()) and role='owner'));
create policy inventory_device_result on public.inventory_requests for update to authenticated using(status='pending' and shop_id in (select shop_id from public.inventory_members where user_id=(select auth.uid()) and role in ('owner','device'))) with check(status in ('applied','rejected') and shop_id in (select shop_id from public.inventory_members where user_id=(select auth.uid()) and role in ('owner','device')));
create function public.inventory_validate_snapshot() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if jsonb_typeof(new.snapshot)<>'object' or new.snapshot->>'schema' is distinct from '1' or jsonb_typeof(new.snapshot->'products') is distinct from 'array' or octet_length(new.snapshot::text)>8388608 then raise exception 'ข้อมูลสินค้าไม่ถูกต้องหรือใหญ่เกินกำหนด'; end if;
  if tg_op='UPDATE' then
    if new.device_instance<>old.device_instance then raise exception 'ร้านนี้เชื่อมกับ POS อีกเครื่องอยู่'; end if;
    if new.revision<old.revision or (new.revision=old.revision and new.snapshot<>old.snapshot) then raise exception 'ข้อมูล POS เก่ากว่าที่เคยซิงก์ กรุณาตรวจสอบการกู้คืนข้อมูล'; end if;
  end if;
  new.synced_at=now();return new;
end;
$$;
create trigger inventory_snapshot_revision before insert or update on public.inventory_snapshots for each row execute function public.inventory_validate_snapshot();
-- Membership rows must be assigned by the project administrator after checking
-- the authenticated account IDs. Applications have no membership write access.
commit;
