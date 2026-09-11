begin;
create table if not exists public.office_staff (
 user_id uuid primary key references auth.users(id),
 shop_id uuid not null references public.inventory_central(shop_id),
 username text not null unique check(username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
 display_name text not null check(length(display_name) between 1 and 120),
 role text not null check(role in ('manager','stock','reports')),
 active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.office_staff enable row level security;
revoke all on public.office_staff from public,anon,authenticated;
grant select on public.office_staff to authenticated;
grant select,insert,update,delete on public.office_staff to service_role;
create policy office_staff_self_or_owner on public.office_staff for select to authenticated using(user_id=(select auth.uid()) or shop_id in(select shop_id from public.inventory_members where user_id=(select auth.uid()) and role='owner'));
-- Staff are deliberately not members of inventory_members: its old policies
-- never grant them direct access to raw costs, reports or write endpoints.
commit;
