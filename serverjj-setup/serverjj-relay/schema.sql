-- Additive relay for SERVERJJ. Inactive until a complete publication commits.
-- Browsers can read their shop and enqueue commands; only the authenticated
-- server gateway may publish results. This migration contains no credentials.
begin;
create table public.inventory_central (
  shop_id uuid primary key, server_id uuid not null unique,
  key_hash text not null check(key_hash ~ '^[0-9a-f]{64}$'),
  active boolean not null default false,
  generation uuid, previous_generation uuid,
  revision bigint not null default 0 check(revision>=0),
  manifest jsonb not null default '{}' check(jsonb_typeof(manifest)='object' and octet_length(manifest::text)<16384),
  device_status jsonb not null default '[]' check(jsonb_typeof(device_status)='array' and octet_length(device_status::text)<8192),
  synced_at timestamptz, created_at timestamptz not null default now()
);
create table public.inventory_central_rows (
  shop_id uuid not null references public.inventory_central(shop_id),
  generation uuid not null,
  collection text not null check(collection in ('products','suppliers','purchases','movements','meta')),
  id text not null check(id ~ '^[A-Za-z0-9_-]{1,160}$'),
  body jsonb not null check(jsonb_typeof(body)='object' and octet_length(body::text)<=262144),
  created_at timestamptz not null default now(),
  primary key(shop_id,generation,collection,id)
);
create table public.inventory_central_requests (
  id uuid primary key, shop_id uuid not null references public.inventory_central(shop_id),
  created_by uuid not null references auth.users(id),
  type text not null check(type in ('product.save','stock.receive','stock.count','supplier.save','purchase.receive')),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=262144),
  status text not null default 'pending' check(status in ('pending','applied','rejected')),
  message text, created_at timestamptz not null default now(), completed_at timestamptz
);
create index inventory_central_pending on public.inventory_central_requests(shop_id,status,created_at,id);
alter table public.inventory_central enable row level security;
alter table public.inventory_central_rows enable row level security;
alter table public.inventory_central_requests enable row level security;
revoke all on public.inventory_central,public.inventory_central_rows,public.inventory_central_requests from public,anon,authenticated;
grant select(shop_id,server_id,active,generation,revision,manifest,device_status,synced_at) on public.inventory_central to authenticated;
grant select on public.inventory_central_rows,public.inventory_central_requests to authenticated;
grant insert on public.inventory_central_requests to authenticated;
grant select,insert,update,delete on public.inventory_central,public.inventory_central_rows,public.inventory_central_requests to service_role;
grant select,update on public.inventory_requests to service_role;
grant select on public.inventory_members to service_role;
create policy central_status_read on public.inventory_central for select to authenticated using(shop_id in(select shop_id from public.inventory_members where user_id=(select auth.uid())));
create policy central_rows_read on public.inventory_central_rows for select to authenticated using(
  shop_id in(select shop_id from public.inventory_members where user_id=(select auth.uid()) and role='owner')
  and generation in(select generation from public.inventory_central where active=true)
);
create policy central_requests_read on public.inventory_central_requests for select to authenticated using(shop_id in(select shop_id from public.inventory_members where user_id=(select auth.uid()) and role='owner'));
create policy central_requests_insert on public.inventory_central_requests for insert to authenticated with check(
  created_by=(select auth.uid()) and status='pending' and message is null and completed_at is null
  and shop_id in(select shop_id from public.inventory_members where user_id=(select auth.uid()) and role='owner')
  and shop_id in(select shop_id from public.inventory_central where active=true)
);

create function public.inventory_central_stage(p_shop uuid,p_server uuid,p_key_hash text,p_generation uuid,p_records jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare c public.inventory_central%rowtype; item record;
begin
  select * into c from public.inventory_central where shop_id=p_shop for update;
  if not found or c.server_id is distinct from p_server or c.key_hash is distinct from p_key_hash then raise exception 'Server authorization failed'; end if;
  if p_generation is null or p_generation=c.generation or p_generation=c.previous_generation then raise exception 'Published data cannot be changed'; end if;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)>200 then raise exception 'Invalid publication page'; end if;
  for item in select * from jsonb_to_recordset(p_records) as x(collection text,id text,body jsonb) loop
    insert into public.inventory_central_rows(shop_id,generation,collection,id,body)
    values(p_shop,p_generation,item.collection,item.id,item.body)
    on conflict(shop_id,generation,collection,id) do update set body=excluded.body;
  end loop;
end; $$;

create function public.inventory_central_publish(p_shop uuid,p_server uuid,p_key_hash text,p_generation uuid,p_revision bigint,p_manifest jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare c public.inventory_central%rowtype; item record; actual bigint;
begin
  select * into c from public.inventory_central where shop_id=p_shop for update;
  if not found or c.server_id is distinct from p_server or c.key_hash is distinct from p_key_hash then raise exception 'Server authorization failed'; end if;
  if p_generation=c.generation and p_revision=c.revision then update public.inventory_central set synced_at=now() where shop_id=p_shop; return; end if;
  if p_generation is null or p_revision<=c.revision or jsonb_typeof(p_manifest)<>'object' then raise exception 'Publication is older than cloud state'; end if;
  if (select count(*) from jsonb_object_keys(p_manifest))<>5 then raise exception 'Incomplete publication manifest'; end if;
  for item in select key,value from jsonb_each_text(p_manifest) loop
    if item.key not in('products','suppliers','purchases','movements','meta') or item.value !~ '^[0-9]{1,6}$' then raise exception 'Invalid publication manifest'; end if;
    select count(*) into actual from public.inventory_central_rows where shop_id=p_shop and generation=p_generation and collection=item.key;
    if actual<>item.value::bigint then raise exception 'Publication page is missing'; end if;
  end loop;
  if (p_manifest->>'meta')::bigint<>1 then raise exception 'Publication metadata is missing'; end if;
  if not c.active then
    insert into public.inventory_central_requests(id,shop_id,created_by,type,payload,status,message,created_at,completed_at)
    select id,shop_id,created_by,type,payload,status,message,created_at,completed_at from public.inventory_requests where shop_id=p_shop and status='pending'
    on conflict(id) do nothing;
    update public.inventory_requests set status='rejected',message='ย้ายรายการไปให้ SERVERJJ รับผิดชอบแล้ว',completed_at=now() where shop_id=p_shop and status='pending';
  end if;
  update public.inventory_central set active=true,previous_generation=generation,generation=p_generation,revision=p_revision,manifest=p_manifest,synced_at=now() where shop_id=p_shop;
  delete from public.inventory_central_rows where shop_id=p_shop and generation<>p_generation and (c.generation is null or generation<>c.generation);
end; $$;

create function public.inventory_central_result(p_shop uuid,p_server uuid,p_key_hash text,p_id uuid,p_status text,p_message text)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.inventory_central where shop_id=p_shop and server_id=p_server and key_hash=p_key_hash and active=true for update;
  if not found or p_status not in('applied','rejected') then raise exception 'Invalid server result'; end if;
  update public.inventory_central_requests set status=p_status,message=left(p_message,500),completed_at=now() where shop_id=p_shop and id=p_id and status='pending';
  -- Results are sent only after the request and result are archived on SERVERJJ.
  delete from public.inventory_central_requests where shop_id=p_shop and status in('applied','rejected') and completed_at<now()-interval '180 days';
end; $$;
revoke all on function public.inventory_central_stage(uuid,uuid,text,uuid,jsonb),public.inventory_central_publish(uuid,uuid,text,uuid,bigint,jsonb),public.inventory_central_result(uuid,uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.inventory_central_stage(uuid,uuid,text,uuid,jsonb),public.inventory_central_publish(uuid,uuid,text,uuid,bigint,jsonb),public.inventory_central_result(uuid,uuid,text,uuid,text,text) to service_role;

create function public.inventory_central_fence_legacy() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.inventory_central where shop_id=new.shop_id and active=true) then
    raise exception 'ร้านนี้เชื่อมผ่าน SERVERJJ แล้ว กรุณาเปิดเว็บหรือ POS รุ่นล่าสุด';
  end if;
  return new;
end; $$;
create trigger inventory_central_fence_snapshot before insert or update on public.inventory_snapshots for each row execute function public.inventory_central_fence_legacy();
create trigger inventory_central_fence_request before insert on public.inventory_requests for each row execute function public.inventory_central_fence_legacy();
commit;
