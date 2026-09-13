const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const temp=path.resolve(process.env.OFFICE_API_TEST_BUNDLE||'work/api-test.cjs');fs.mkdirSync(path.dirname(temp),{recursive:true});
if(!process.env.OFFICE_API_TEST_BUNDLE){const compiled=spawnSync(process.execPath,[require.resolve('esbuild/bin/esbuild'),'app/office-api.ts','--bundle','--platform=node','--format=cjs',`--outfile=${temp}`],{stdio:'inherit',windowsHide:true});if(compiled.error)throw compiled.error;assert.equal(compiled.status,0);}
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k),values:()=>[...map.values()]};};
global.localStorage=storage();global.sessionStorage=storage();
const owner='00000000-0000-4000-8000-000000000001',shop='10000000-0000-4000-8000-000000000001';
let allowed=true,expires=3600,refreshes=0,lost=false,conflict=false,rows=new Map(),requests=[];
let centralMode='missing',generation='50000000-0000-4000-8000-000000000001',revision=8,centralReads=0,missingPage=false,switchPage=false,centralRequests=new Map();
const centralRows=[{collection:'meta',id:'categories',body:{categories:['ทั่วไป']}},...Array.from({length:201},(_,i)=>({collection:'products',id:'p'+i,body:{id:'p'+i,name:'สินค้าทดสอบ '+i,stockOnHand:i}}))];
global.fetch=async(url,options={})=>{
  const u=new URL(url),body=options.body?JSON.parse(options.body):null;requests.push({path:u.pathname,method:options.method||'GET',headers:options.headers,body});
  const result=(data,status=200)=>new Response(data===null?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  if(u.pathname==='/auth/v1/token'){if(u.search.includes('refresh_token')){refreshes++;return result({access_token:'refreshed',refresh_token:'new-refresh',expires_in:3600});}return result({access_token:'access',refresh_token:'refresh',expires_in:expires});}
  if(u.pathname==='/auth/v1/logout')return result(null,204);
  if(u.pathname==='/rest/v1/inventory_members')return result(allowed?[{user_id:owner,shop_id:shop,role:'owner'}]:[]);
  if(u.pathname==='/rest/v1/inventory_central')return centralMode==='missing'?result({message:'not installed'},404):result([{active:centralMode==='active',generation,revision,manifest:{products:201,suppliers:0,purchases:0,movements:0,meta:1},device_status:[{id:'one',label:'POS 1',online:false,pending:2}],synced_at:new Date().toISOString()}]);
  if(u.pathname==='/rest/v1/inventory_central_rows'){
    centralReads++;const offset=Number(u.searchParams.get('offset'));
    if(switchPage&&offset){switchPage=false;generation='50000000-0000-4000-8000-000000000002';revision++;return result([]);}
    if(missingPage&&offset)return result([]);
    assert.equal(u.searchParams.get('generation'),'eq.'+generation);return result(centralRows.slice(offset,offset+200));
  }
  if(u.pathname==='/rest/v1/inventory_central_requests'){
    if(options.method==='POST'){if(centralRequests.has(body.id))return result({message:'duplicate'},409);centralRequests.set(body.id,body);if(lost){lost=false;throw Error('Network response lost');}return result(null,201);}
    if(u.searchParams.has('id')){const row=centralRequests.get(u.searchParams.get('id').slice(3));return result(row?[row]:[]);}return result([...centralRequests.values()]);
  }
  if(u.pathname==='/rest/v1/inventory_snapshots')return result([{snapshot:{schema:1,revision:1,products:[],categories:[],suppliers:[],purchases:[],movements:[]},synced_at:'2026-09-05T00:00:00Z'}]);
  if(u.pathname==='/rest/v1/inventory_requests'){
    if(options.method==='POST'){if(rows.has(body.id))return result({message:'duplicate'},409);rows.set(body.id,body);if(lost){lost=false;throw Error('Network response lost');}return result(null,201);}
    if(u.searchParams.has('id')){const row=rows.get(u.searchParams.get('id').slice(3));return result(row?[conflict?{...row,payload:{different:true}}:row]:[]);}
    return result([...rows.values()]);
  }
  throw Error('Unexpected request '+u.pathname);
};
const api=require(temp);let passed=0;
async function test(label,run){await run();passed++;console.log('PASS',label);}
(async()=>{
  await test('owner login stores a session without storing password',async()=>{assert.equal(await api.login('owner@example.test','private-test-password'),'owner@example.test');assert(!sessionStorage.values().join('').includes('private-test-password'));});
  await test('cloud reads are scoped to the authorized shop',async()=>{const data=await api.loadOffice();assert.equal(data.snapshot.revision,1);assert(requests.filter(r=>r.path.startsWith('/rest/')).every(r=>r.headers.Authorization));});
  await test('lost response retry reuses the same request without duplication',async()=>{lost=true;const id='30000000-0000-4000-8000-000000000001';await assert.rejects(api.submit(id,'stock.receive',{quantity:1}),/Network response lost/);await api.submit(id,'stock.receive',{quantity:1});assert.equal(rows.size,1);});
  await test('conflicting duplicate IDs are rejected',async()=>{conflict=true;await assert.rejects(api.submit('30000000-0000-4000-8000-000000000001','stock.receive',{quantity:1}),/เลขรายการซ้ำ/);conflict=false;});
  await test('logout clears cached authentication',async()=>{await api.logout();assert.equal(sessionStorage.values().length,0);await assert.rejects(api.loadOffice(),/เข้าสู่ระบบ/);});
  await test('account without owner membership is denied and logged out',async()=>{allowed=false;await assert.rejects(api.login('unknown@example.test','test'),/สิทธิ์เจ้าของร้าน/);assert.equal(sessionStorage.values().length,0);allowed=true;});
  await test('expired token refresh is shared by concurrent reads',async()=>{await api.login('owner@example.test','test');const originalNow=Date.now,advance=originalNow()+3600000;Date.now=()=>advance;try{await api.loadOffice();assert.equal(refreshes,1);}finally{Date.now=originalNow;}});
  await test('configuration rejects secret/service keys',async()=>{assert.throws(()=>api.savePublicKey('sb_secret_not_allowed'),/Publishable/);});
  await test('session restores through authorized membership check',async()=>{assert.equal(await api.restore(),'owner@example.test');});
  await test('inactive SERVERJJ preparation preserves the legacy connection',async()=>{centralMode='inactive';assert.equal((await api.loadOffice()).source,'pos');});
  await test('SERVERJJ snapshot loads every page and caches unchanged images',async()=>{centralMode='active';let data=await api.loadOffice();assert.equal(data.source,'serverjj');assert.equal(data.snapshot.products.length,201);assert.equal(centralReads,2);assert.equal(data.devices[0].pending,2);await api.loadOffice();assert.equal(centralReads,2);});
  await test('incomplete publication does not return partial stock',async()=>{generation='50000000-0000-4000-8000-000000000003';revision++;missingPage=true;await assert.rejects(api.loadOffice(),/ไม่ครบ/);missingPage=false;});
  await test('publication changes during pagination are retried from a complete generation',async()=>{switchPage=true;const data=await api.loadOffice();assert.equal(data.snapshot.products.length,201);assert.equal(data.snapshot.revision,revision);});
  await test('central command retry is once-only and never goes to legacy POS',async()=>{const count=rows.size,id='30000000-0000-4000-8000-000000000002';lost=true;await assert.rejects(api.submit(id,'stock.receive',{quantity:3}),/Network response lost/);await api.submit(id,'stock.receive',{quantity:3});assert.equal(centralRequests.size,1);assert.equal(rows.size,count);});
  console.log(`${passed} web authentication and synchronization API checks passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
