import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/office-staff/handler.mjs';
const uid='11111111-1111-4111-8111-111111111111',shop='22222222-2222-4222-8222-222222222222',generation='33333333-3333-4333-8333-333333333333';
function fixture(role='employee',active=true){
 const writes=[],reads=[];
 const fetchImpl=async(url,options={})=>{
  const path=new URL(url).pathname,query=new URL(url).searchParams;
  if(options.method&&options.method!=='GET')writes.push({path,body:JSON.parse(options.body||'null')});else reads.push(path);
  let result;
  if(path==='/auth/v1/user')result={id:uid,email:'staff@staff.chutima.invalid'};
  else if(path==='/rest/v1/inventory_members')result=role==='owner'?[{shop_id:shop}]:[];
  else if(path==='/rest/v1/office_staff')result=query.has('username')?[]:active?[{user_id:uid,shop_id:shop,role,display_name:'พนักงาน',active:true}]:[];
  else if(path==='/rest/v1/inventory_central')result=[{active:true,generation,revision:1,manifest:{products:1,meta:1},device_status:[],synced_at:'2026-09-10'}];
  else if(path==='/rest/v1/inventory_central_rows')result=[{collection:'products',id:'p1',body:{id:'p1',name:'สินค้า',trashedAt:'2026-09-13T00:00:00Z',price:20,costPrice:10,stockOnHand:4,version:'contains-cost-10',stockVersion:'secret'}},{collection:'meta',id:'catalog',body:{productTrashVersion:1,employeeWorkflowVersion:1,reportPage:{rows:[{secret:100}]},purchaseOrders:[{total:500}]}}];
  else if(path==='/rest/v1/inventory_central_requests')result=[];
  else if(path==='/auth/v1/admin/users')result={id:'44444444-4444-4444-8444-444444444444'};
  else throw Error('unexpected '+path);
  if(path==='/rest/v1/inventory_central_rows'&&query.get('collection')==='eq.meta')result=result.filter(r=>r.collection==='meta');
  return new Response(JSON.stringify(result),{status:200});
 };
 const handler=createHandler({env:name=>({SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'private-service',SUPABASE_ANON_KEY:'public-key'})[name],fetchImpl});
 const call=body=>handler(new Request('https://example.test/functions/v1/office-staff',{method:'POST',headers:{Authorization:'Bearer verified-user-token',Origin:'https://chutimafresh88.github.io'},body:JSON.stringify(body)}));
 return {call,writes,reads};
}
const stock=fixture();let response=await stock.call({action:'load'});assert.equal(response.status,200);const data=await response.json();assert.equal(data.snapshot.products[0].stockOnHand,4);assert.equal(data.snapshot.products[0].costPrice,undefined);assert.equal(data.snapshot.products[0].version,undefined);assert.deepEqual(data.snapshot.purchases,[]);assert.equal(data.snapshot.reportPage,null);
const rowsBefore=stock.reads.filter(path=>path==='/rest/v1/inventory_central_rows').length;
const unchanged=await (await stock.call({action:'load',generation,revision:1})).json();assert.equal(unchanged.unchanged,true);assert.equal(unchanged.snapshot,null);assert.equal(unchanged.generation,generation);assert.equal(stock.reads.filter(path=>path==='/rest/v1/inventory_central_rows').length,rowsBefore);
for(const action of ['create','update','list','submit'])assert.equal((await stock.call({action,id:generation,type:'purchase.receive',payload:{workflow:'report.prepare'}})).status,403);
assert.equal(stock.writes.length,0);
const reports=fixture('manager');assert.equal((await reports.call({action:'submit',id:generation,type:'stock.receive',payload:{quantity:50}})).status,200);assert.equal((await reports.call({action:'submit',id:generation,type:'purchase.receive',payload:{workflow:'report.prepare',kind:'sales'}})).status,200);assert.equal(reports.writes[0].body.created_by,uid);assert.equal(reports.writes[0].body.shop_id,shop);
assert.equal((await fixture('manager',false).call({action:'load'})).status,403);
const owner=fixture('owner');assert.equal((await owner.call({action:'create',username:'staff1',displayName:'ทดสอบ',role:'employee',password:'long-test-only-password'})).status,200);assert.equal(owner.writes[0].path,'/auth/v1/admin/users');assert.equal(owner.writes[1].body.password,undefined);assert.equal(owner.writes[1].body.password_verifier.algorithm,'PBKDF2-SHA256');assert.equal(owner.writes[1].body.shop_id,shop);
assert.equal((await fixture('manager').call({action:'create',username:'evil',role:'owner',password:'long-test-only-password'})).status,400);
console.log('Staff authorization: stock cost redaction, role boundaries, disabled users and owner creation passed');

for (const password of ['1234','12345']) { const f=fixture('owner'); assert.equal((await f.call({action:'create',username:'staff2',displayName:'Test',role:'employee',password})).status,400); assert.equal(f.writes.length,0); }
assert.equal((await fixture('owner').call({action:'create',username:'staff2',displayName:'Test',role:'employee',password:'abc123'})).status,200);

assert.equal((await fixture('manager').call({action:'submit',id:generation,type:'purchase.receive',payload:{workflow:'office.settings',settings:{name:'test'}}})).status,200);

const legacy=fixture('owner');const list=await (await legacy.call({action:'list'})).json();assert.equal(list.users[0].pos_ready,false);assert.equal(list.users[0].password_verifier,undefined);assert.equal((await legacy.call({action:'update',userId:uid,role:'employee',active:true})).status,400);assert.equal(legacy.writes.length,0);

assert.equal(data.snapshot.productTrashVersion,1);assert.equal(data.snapshot.products[0].trashedAt,'2026-09-13T00:00:00Z');
const managerTrash=await (await fixture('manager').call({action:'load'})).json();assert.equal(managerTrash.snapshot.productTrashVersion,1);assert.equal(managerTrash.snapshot.products[0].trashedAt,'2026-09-13T00:00:00Z');
