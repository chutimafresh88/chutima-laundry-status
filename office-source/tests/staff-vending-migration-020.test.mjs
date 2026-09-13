import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';import assert from 'node:assert/strict';
const db=new PGlite();
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;`);
 for(const name of ['202609050001_private_inventory.sql','202609080001_serverjj_relay.sql','202609100001_office_staff.sql','202609100002_office_collections.sql'])await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 const owner='11111111-1111-4111-8111-111111111111',employee='22222222-2222-4222-8222-222222222222',shop='33333333-3333-4333-8333-333333333333';
 await db.query('INSERT INTO auth.users VALUES($1),($2)',[owner,employee]);await db.query("INSERT INTO inventory_members VALUES($1,$2,'owner')",[owner,shop]);await db.query("INSERT INTO inventory_central(shop_id,server_id,key_hash) VALUES($1,gen_random_uuid(),repeat('a',64))",[shop]);
 await db.query("INSERT INTO office_staff(user_id,shop_id,username,display_name,role) VALUES($1,$2,'staff1','Employee','reports')",[employee,shop]);
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260913045402_staff_and_vending_020.sql',import.meta.url),'utf8'));
 assert.equal((await db.query('SELECT role FROM office_staff')).rows[0].role,'employee');
 await db.exec('SET ROLE service_role');await db.query("UPDATE office_staff SET display_name='New name',updated_by=$1 WHERE user_id=$2",[owner,employee]);
 const job=(await db.query('SELECT payload,created_by,status FROM inventory_central_requests')).rows[0];assert.equal(job.created_by,owner);assert.equal(job.status,'pending');assert.equal(job.payload.workflow,'employee.save');assert.equal(job.payload.role,'employee');assert.equal(job.payload.name,'New name');
 await assert.rejects(db.exec("UPDATE office_staff SET password_verifier='{}'::jsonb"),/office_staff_password_verifier_check/);
 await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[employee]);await db.exec('SET ROLE authenticated');
 assert.equal((await db.query('SELECT user_id,username,role FROM office_staff')).rows.length,1);
 await assert.rejects(db.exec('SELECT password_verifier FROM office_staff'),/permission denied/);
 await assert.rejects(db.exec("UPDATE office_staff SET role='manager'"),/permission denied/);
 assert.equal((await db.query('SELECT * FROM inventory_central_requests')).rows.length,0);
 await db.exec('RESET ROLE');await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260913060834_protect_employee_sync_verifiers.sql',import.meta.url),'utf8'));await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('SET ROLE authenticated');assert.equal((await db.query('SELECT * FROM inventory_central_requests')).rows.length,0);await db.exec('RESET ROLE');await db.exec('SET ROLE service_role');assert.equal((await db.query('SELECT * FROM inventory_central_requests')).rows.length,1);
 console.log('PASS 0.20 migration: two roles, durable POS updates, verifier redaction and employee/owner read isolation');
}finally{await db.close();}
