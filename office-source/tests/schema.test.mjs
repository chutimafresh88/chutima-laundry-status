import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; GRANT USAGE ON SCHEMA auth TO anon,authenticated; GRANT USAGE ON SCHEMA public TO anon,authenticated;`);
await db.exec(fs.readFileSync(new URL('../supabase/migrations/202609050001_private_inventory.sql',import.meta.url),'utf8'));
const owner='00000000-0000-4000-8000-000000000001',device='00000000-0000-4000-8000-000000000002',outsider='00000000-0000-4000-8000-000000000003',shop='10000000-0000-4000-8000-000000000001',otherShop='10000000-0000-4000-8000-000000000002',instance='20000000-0000-4000-8000-000000000001',id='30000000-0000-4000-8000-000000000001';
await db.query('INSERT INTO auth.users VALUES ($1),($2),($3)',[owner,device,outsider]);
await db.query("INSERT INTO public.inventory_members VALUES ($1,$2,'owner'),($3,$2,'device'),($4,$5,'owner')",[owner,shop,device,outsider,otherShop]);
let passed=0;
async function run(label,fn){await fn();passed++;console.log('PASS',label);}
async function role(name,user=''){await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec(`SET ROLE ${name}`);}
const payload={schema:1,revision:1,products:[],categories:[],suppliers:[],purchases:[],movements:[]};
await run('anonymous access denied',async()=>{await role('anon');await assert.rejects(db.query('SELECT * FROM public.inventory_snapshots'),/permission denied/);await assert.rejects(db.query('SELECT * FROM public.inventory_requests'),/permission denied/);});
await run('authenticated member sees only own membership',async()=>{await role('authenticated',owner);const r=await db.query('SELECT * FROM public.inventory_members');assert.equal(r.rows.length,1);assert.equal(r.rows[0].user_id,owner);});
await run('membership cannot be granted by app users',async()=>{await assert.rejects(db.query("UPDATE public.inventory_members SET role='device'"),/permission denied/);});
await run('owner can register own primary POS snapshot',async()=>{await db.query('INSERT INTO public.inventory_snapshots(shop_id,device_instance,revision,snapshot) VALUES($1,$2,1,$3)',[shop,instance,JSON.stringify(payload)]);});
await run('another shop cannot read snapshot',async()=>{await role('authenticated',outsider);assert.equal((await db.query('SELECT * FROM public.inventory_snapshots')).rows.length,0);});
await run('another shop cannot replace snapshot',async()=>{await assert.rejects(db.query('INSERT INTO public.inventory_snapshots(shop_id,device_instance,revision,snapshot) VALUES($1,$2,1,$3)',[shop,instance,JSON.stringify(payload)]),/row-level security/);});
await run('owner can enqueue only pending own commands',async()=>{await role('authenticated',owner);await db.query('INSERT INTO public.inventory_requests(id,shop_id,created_by,type,payload) VALUES($1,$2,$3,$4,$5)',[id,shop,owner,'stock.count','{"quantity":0}']);});
await run('payload cannot be changed after submission',async()=>{await assert.rejects(db.query("UPDATE public.inventory_requests SET payload='{}' WHERE id=$1",[id]),/permission denied/);});
await run('created_by cannot impersonate another user',async()=>{await assert.rejects(db.query("INSERT INTO public.inventory_requests(id,shop_id,created_by,type,payload) VALUES(gen_random_uuid(),$1,$2,'stock.receive','{}')",[shop,outsider]),/row-level security/);});
await run('device may read and acknowledge own shop command',async()=>{await role('authenticated',device);assert.equal((await db.query('SELECT * FROM public.inventory_requests')).rows.length,1);await db.query("UPDATE public.inventory_requests SET status='applied',message='ok',completed_at=now() WHERE id=$1",[id]);});
await run('completed command cannot be changed again',async()=>{const r=await db.query("UPDATE public.inventory_requests SET status='rejected' WHERE id=$1 RETURNING id",[id]);assert.equal(r.rows.length,0);});
await run('device cannot create remote owner commands',async()=>{await assert.rejects(db.query("INSERT INTO public.inventory_requests(id,shop_id,created_by,type,payload) VALUES(gen_random_uuid(),$1,$2,'stock.receive','{}')",[shop,device]),/row-level security/);});
await run('stale revision cannot overwrite newer snapshot',async()=>{await assert.rejects(db.query('UPDATE public.inventory_snapshots SET revision=0 WHERE shop_id=$1',[shop]),/ข้อมูล POS เก่า/);});
await run('same revision cannot upload different data',async()=>{await assert.rejects(db.query("UPDATE public.inventory_snapshots SET snapshot=jsonb_set(snapshot,'{products}','[{\"id\":\"p\"}]') WHERE shop_id=$1",[shop]),/ข้อมูล POS เก่า/);});
await run('second POS instance cannot overwrite primary',async()=>{await assert.rejects(db.query('UPDATE public.inventory_snapshots SET device_instance=gen_random_uuid(),revision=2 WHERE shop_id=$1',[shop]),/POS อีกเครื่อง/);});
await run('same snapshot can be resent after lost response',async()=>{await db.query('UPDATE public.inventory_snapshots SET revision=1,snapshot=$1 WHERE shop_id=$2',[JSON.stringify(payload),shop]);});
console.log(`${passed} PostgreSQL authorization and sync checks passed`);await db.close();

