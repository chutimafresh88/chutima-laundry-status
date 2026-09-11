begin;
alter table public.inventory_central_rows drop constraint inventory_central_rows_collection_check;
alter table public.inventory_central_rows add constraint inventory_central_rows_collection_check check(collection in ('products','suppliers','purchases','movements','meta','purchaseOrders','supplierReturns','reportPages'));
create or replace function public.inventory_central_publish(p_shop uuid,p_server uuid,p_key_hash text,p_generation uuid,p_revision bigint,p_manifest jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare c public.inventory_central%rowtype; item record; actual bigint;
begin
  select * into c from public.inventory_central where shop_id=p_shop for update;
  if not found or c.server_id is distinct from p_server or c.key_hash is distinct from p_key_hash then raise exception 'Server authorization failed'; end if;
  if p_generation=c.generation and p_revision=c.revision then update public.inventory_central set synced_at=now() where shop_id=p_shop; return; end if;
  if p_generation is null or p_revision<=c.revision or jsonb_typeof(p_manifest)<>'object' then raise exception 'Publication is older than cloud state'; end if;
  if (select count(*) from jsonb_object_keys(p_manifest))not in (5,8) then raise exception 'Incomplete publication manifest'; end if;
  if not (p_manifest ?& array['products','suppliers','purchases','movements','meta']) then raise exception 'Required collections missing'; end if;
  for item in select key,value from jsonb_each_text(p_manifest) loop
    if item.key not in('products','suppliers','purchases','movements','meta','purchaseOrders','supplierReturns','reportPages') or item.value !~ '^[0-9]{1,6}$' then raise exception 'Invalid publication manifest'; end if;
    select count(*) into actual from public.inventory_central_rows where shop_id=p_shop and generation=p_generation and collection=item.key;
    if actual<>item.value::bigint then raise exception 'Publication page is missing'; end if;
  end loop;
  if exists(select 1 from public.inventory_central_rows where shop_id=p_shop and generation=p_generation and not (p_manifest ? collection)) then raise exception 'Unlisted collection'; end if;
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


commit;
