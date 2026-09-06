-- Run after creating the app account in Authentication > Users.
-- Replace the email below with the owner account that should use this shop.
do $$
declare
  owner_email text := 'YOUR_OWNER_EMAIL';
  owner_id uuid;
  existing_shop uuid;
begin
  select id into owner_id from auth.users where lower(email)=lower(owner_email);
  if owner_id is null then
    raise exception 'ไม่พบบัญชีแอป กรุณาสร้างใน Authentication > Users และแก้อีเมลในไฟล์นี้ก่อน';
  end if;
  select shop_id into existing_shop from public.inventory_members where user_id=owner_id;
  insert into public.inventory_members(user_id,shop_id,role)
  values(owner_id,coalesce(existing_shop,gen_random_uuid()),'owner')
  on conflict(user_id) do update set role='owner';
end;
$$;
