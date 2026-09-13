import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;`);
for(const name of ['202609050001_private_inventory.sql','202609080001_serverjj_relay.sql'])await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
const owner='00000000-0000-4000-8000-000000000001',outsider='00000000-0000-4000-8000-000000000002',shop='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',server='20000000-0000-4000-8000-000000000001',generation='30000000-0000-4000-8000-000000000001',nextGeneration='30000000-0000-4000-8000-000000000002',command='40000000-0000-4000-8000-000000000001';
const hash='a'.repeat(64); // Non-secret fixture digest, not an authentication key.
await db.query('INSERT INTO auth.users VALUES($1),($2)',[owner,outsider]);
await db.query("INSERT INTO public.inventory_members VALUES($1,$2,'owner'),($3,$4,'owner')",[owner,shop,outsider,other]);
await db.query('INSERT INTO public.inventory_central(shop_id,server_id,key_hash) VALUES($1,$2,$3)',[shop,server,hash]);
async function role(name,user=''){await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('SET ROLE '+name);}
async function stage(gen,records,keyHash=hash){return db.query('SELECT public.inventory_central_stage($1,$2,$3,$4,$5)',[shop,server,keyHash,gen,JSON.stringify(records)]);}
const manifest={products:1,suppliers:0,purchases:0,movements:0,meta:1};
async function publish(gen,revision,counts=manifest){return db.query('SELECT public.inventory_central_publish($1,$2,$3,$4,$5,$6)',[shop,server,hash,gen,revision,JSON.stringify(counts)]);}
await role('anon');await assert.rejects(db.query('SELECT active FROM public.inventory_central'),/permission denied/);await assert.rejects(db.query('SELECT * FROM public.inventory_central_rows'),/permission denied/);
await role('authenticated',owner);
assert.equal((await db.query('SELECT active FROM public.inventory_central')).rows[0].active,false);
await assert.rejects(db.query('SELECT key_hash FROM public.inventory_central'),/permission denied/);
await assert.rejects(stage(generation,[]),/permission denied/);
await assert.rejects(db.query("UPDATE public.inventory_central SET active=true"),/permission denied/);
await db.query('INSERT INTO public.inventory_snapshots(shop_id,device_instance,revision,snapshot) VALUES($1,$2,1,$3)',[shop,server,JSON.stringify({schema:1,products:[]})]);
await db.query("INSERT INTO public.inventory_requests(id,shop_id,created_by,type,payload) VALUES($1,$2,$3,'stock.receive','{}')",[command,shop,owner]);
console.log('PASS inactive relay preserves existing POS/web; browser cannot read server hash or publish data');
await role('service_role');
await assert.rejects(stage(generation,[],null),/authorization/);
await assert.rejects(stage(generation,[{collection:'customers',id:'private',body:{name:'must not be published'}}]),/check constraint/);
await stage(generation,[{collection:'products',id:'soap',body:{id:'soap',name:'ข้อมูลทดสอบ',stockOnHand:4}},{collection:'meta',id:'categories',body:{categories:[]}}]);
await role('authenticated',owner);assert.equal((await db.query('SELECT * FROM public.inventory_central_rows')).rows.length,0);
await role('service_role');await assert.rejects(publish(generation,2,{...manifest,products:2}),/missing/);await publish(generation,2);
await role('authenticated',owner);assert.equal((await db.query('SELECT * FROM public.inventory_central_rows')).rows.length,2);assert.equal((await db.query('SELECT * FROM public.inventory_central_requests')).rows[0].id,command);
await assert.rejects(db.query('UPDATE public.inventory_snapshots SET revision=2 WHERE shop_id=$1',[shop]),/SERVERJJ/);
await assert.rejects(db.query("INSERT INTO public.inventory_requests(id,shop_id,created_by,type,payload) VALUES(gen_random_uuid(),$1,$2,'stock.receive','{}')",[shop,owner]),/SERVERJJ/);
console.log('PASS publication is atomic; missing pages stay hidden, queued legacy command moves once, old writers are fenced');
await role('authenticated',outsider);assert.equal((await db.query('SELECT active FROM public.inventory_central')).rows.length,0);assert.equal((await db.query('SELECT * FROM public.inventory_central_rows')).rows.length,0);assert.equal((await db.query('SELECT * FROM public.inventory_central_requests')).rows.length,0);
await role('authenticated',owner);await assert.rejects(db.query("UPDATE public.inventory_central_requests SET status='applied'"),/permission denied/);
await role('service_role');await assert.rejects(stage(generation,[]),/cannot be changed/);
await stage(nextGeneration,[{collection:'products',id:'soap',body:{id:'soap',name:'ข้อมูลใหม่',stockOnHand:3}},{collection:'meta',id:'categories',body:{categories:[]}}]);
await assert.rejects(publish(nextGeneration,1),/older/);await publish(nextGeneration,3);
await db.query('SELECT public.inventory_central_result($1,$2,$3,$4,$5,$6)',[shop,server,hash,command,'applied','บันทึกใน SERVERJJ แล้ว']);
await db.query('SELECT public.inventory_central_result($1,$2,$3,$4,$5,$6)',[shop,server,hash,command,'rejected','must not replace']);
await role('authenticated',owner);assert.equal((await db.query('SELECT * FROM public.inventory_central_rows WHERE collection=$1',['products'])).rows[0].body.stockOnHand,3);assert.equal((await db.query('SELECT status FROM public.inventory_central_requests')).rows[0].status,'applied');
console.log('PASS shop isolation, immutable published generation, rollback fence and once-only result acknowledgement');
await db.close();
