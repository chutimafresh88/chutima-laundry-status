import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';import assert from 'node:assert/strict';
const db=new PGlite();
try{
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;`);
for(const name of ['202609050001_private_inventory.sql','202609080001_serverjj_relay.sql','202609100001_office_staff.sql','202609100002_office_collections.sql'])await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
const owner='11111111-1111-4111-8111-111111111111',staff='22222222-2222-4222-8222-222222222222',shop='33333333-3333-4333-8333-333333333333';
await db.query('INSERT INTO auth.users VALUES ($1),($2)',[owner,staff]);await db.query("INSERT INTO inventory_members VALUES($1,$2,'owner')",[owner,shop]);
await db.query("INSERT INTO inventory_central(shop_id,server_id,key_hash) VALUES($1,gen_random_uuid(),repeat('a',64))",[shop]);
await db.query("INSERT INTO office_staff(user_id,shop_id,username,display_name,role) VALUES($1,$2,'stock1','Stock','stock')",[staff,shop]);
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[staff]);await db.exec('SET ROLE authenticated');
assert.equal((await db.query('SELECT * FROM office_staff')).rows.length,1);assert.equal((await db.query('SELECT shop_id,active FROM inventory_central')).rows.length,0);assert.equal((await db.query('SELECT * FROM inventory_central_rows')).rows.length,0);
await assert.rejects(db.exec("UPDATE office_staff SET role='manager'"),/permission denied/);
console.log('Migration and staff RLS tests passed');
}finally{await db.close();}
