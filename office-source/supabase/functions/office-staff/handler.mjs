const failure=(status,message)=>Object.assign(Error(message),{status});
const uuid=s=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(s||'');
const roles=['manager','stock','reports'];
const canonical=x=>x&&typeof x==='object'?Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
function key(env,group,fallback,prefix){try{const value=Object.values(JSON.parse(env(group)||'{}')).find(k=>typeof k==='string'&&k.startsWith(prefix));if(value)return value;}catch{}return env(fallback)||'';}
export function createHandler({env,fetchImpl=fetch}){return async req=>{
 const origin=req.headers.get('origin'),allowed='https://chutimafresh88.github.io';
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(origin===allowed?{'Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'}:{})};
 const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
 try{
  if(origin&&origin!==allowed)throw failure(403,'ที่มาคำขอไม่ถูกต้อง');if(req.method==='OPTIONS')return new Response(null,{status:204,headers});if(req.method!=='POST')throw failure(405,'ไม่รองรับคำขอ');
  const token=req.headers.get('authorization')||'';if(!token.startsWith('Bearer '))throw failure(401,'กรุณาเข้าสู่ระบบ');
  const url=env('SUPABASE_URL'),service=key(env,'SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY','sb_secret_'),pub=key(env,'SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY','sb_publishable_');if(!url||!service||!pub)throw failure(503,'ระบบพนักงานยังไม่พร้อม');
  const auth=await fetchImpl(url+'/auth/v1/user',{headers:{apikey:pub,Authorization:token},signal:AbortSignal.timeout(15000)});if(!auth.ok)throw failure(401,'กรุณาเข้าสู่ระบบใหม่');const user=await auth.json();if(!uuid(user.id))throw failure(401,'บัญชีไม่ถูกต้อง');
  async function admin(path,method='GET',body){const r=await fetchImpl(url+path,{method,headers:{apikey:service,...(!service.startsWith('sb_secret_')?{Authorization:'Bearer '+service}:{}),'Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw failure(r.status===409||r.status===422?409:502,r.status===409||r.status===422?'ชื่อผู้ใช้นี้ใช้แล้ว หรือข้อมูลไม่ถูกต้อง':'บันทึกไม่สำเร็จ กรุณาลองใหม่');return r.status===204?null:r.json();}
  const owners=await admin('/rest/v1/inventory_members?user_id=eq.'+user.id+'&role=eq.owner&select=shop_id'),owner=owners.length===1;
  const staff=owner?null:(await admin('/rest/v1/office_staff?user_id=eq.'+user.id+'&active=eq.true&select=*'))[0];if(!owner&&!staff)throw failure(403,'บัญชีไม่มีสิทธิ์หรือถูกปิดใช้งาน');
  const shop=owner?owners[0].shop_id:staff.shop_id,role=owner?'owner':staff.role;
  const text=await req.text();if(text.length>300000)throw failure(413,'ข้อมูลใหญ่เกินกำหนด');let input;try{input=JSON.parse(text);}catch{throw failure(400,'ข้อมูลไม่ถูกต้อง');}
  if(input.action==='list'){if(!owner)throw failure(403,'เฉพาะเจ้าของร้าน');return reply(200,{users:await admin('/rest/v1/office_staff?shop_id=eq.'+shop+'&select=user_id,username,display_name,role,active,created_at&order=created_at.desc')});}
  if(input.action==='create'){
   if(!owner)throw failure(403,'เฉพาะเจ้าของร้าน');const username=String(input.username||'').trim().toLowerCase(),name=String(input.displayName||'').trim();
   if(!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)||!name||name.length>120||!roles.includes(input.role)||typeof input.password!=='string'||input.password.length<6||input.password.length>128)throw failure(400,'ชื่อผู้ใช้ 3–32 ตัวอักษรอังกฤษ และรหัสผ่านอย่างน้อย 6 ตัวอักษร');
   if((await admin('/rest/v1/office_staff?username=eq.'+encodeURIComponent(username)+'&select=user_id')).length)throw failure(409,'ชื่อผู้ใช้นี้มีแล้ว');
   const created=await admin('/auth/v1/admin/users','POST',{email:username+'@staff.chutima.invalid',password:input.password,email_confirm:true,app_metadata:{office_shop_id:shop}});const id=created.id||created.user?.id;if(!uuid(id))throw failure(502,'สร้างบัญชีไม่สำเร็จ');
   try{await admin('/rest/v1/office_staff','POST',{user_id:id,shop_id:shop,username,display_name:name,role:input.role,active:true});}catch(e){await admin('/auth/v1/admin/users/'+id,'DELETE').catch(()=>{});throw e;}
   return reply(200,{created:true});
  }
  if(input.action==='update'){
   if(!owner||!uuid(input.userId))throw failure(403,'เฉพาะเจ้าของร้าน');const target=(await admin('/rest/v1/office_staff?shop_id=eq.'+shop+'&user_id=eq.'+input.userId+'&select=user_id'))[0];if(!target)throw failure(404,'ไม่พบพนักงานร้านนี้');
   if(!roles.includes(input.role)||typeof input.active!=='boolean')throw failure(400,'สิทธิ์ไม่ถูกต้อง');
   if(input.password){if(typeof input.password!=='string'||input.password.length<6||input.password.length>128)throw failure(400,'รหัสผ่านอย่างน้อย 6 ตัวอักษร');await admin('/auth/v1/admin/users/'+target.user_id,'PUT',{password:input.password});}
   await admin('/rest/v1/office_staff?shop_id=eq.'+shop+'&user_id=eq.'+target.user_id,'PATCH',{role:input.role,active:input.active,updated_at:new Date().toISOString()});return reply(200,{updated:true});
  }
  if(input.action==='submit'){
   const {id,type,payload}=input;if(!uuid(id)||!payload||typeof payload!=='object'||Array.isArray(payload))throw failure(400,'รายการไม่ถูกต้อง');
   const manager=role==='owner'||role==='manager',report=role==='reports'&&type==='purchase.receive'&&payload.workflow==='report.prepare';
   if(!(manager&&['product.save','supplier.save','stock.receive','stock.count','purchase.receive'].includes(type)||report))throw failure(403,'ไม่มีสิทธิ์บันทึกรายการนี้');
   const prior=(await admin('/rest/v1/inventory_central_requests?id=eq.'+id+'&shop_id=eq.'+shop+'&select=id,type,payload,created_by'))[0];if(prior){if(prior.created_by!==user.id||prior.type!==type||canonical(prior.payload)!==canonical(payload))throw failure(409,'เลขรายการซ้ำ');return reply(200,{saved:true});}
   await admin('/rest/v1/inventory_central_requests','POST',{id,shop_id:shop,created_by:user.id,type,payload,status:'pending'});return reply(200,{saved:true});
  }
  if(input.action==='load'){
   const c=(await admin('/rest/v1/inventory_central?shop_id=eq.'+shop+'&select=active,generation,revision,manifest,device_status,synced_at'))[0];if(!c?.active||!uuid(c.generation))throw failure(503,'รอ SERVERJJ เชื่อมต่อ');
   const records=[];for(let offset=0;offset<100000;offset+=500){const page=await admin('/rest/v1/inventory_central_rows?shop_id=eq.'+shop+'&generation=eq.'+c.generation+'&select=collection,id,body&order=collection.asc,id.asc&offset='+offset+'&limit=500');records.push(...page);if(page.length<500)break;}
   for(const [collection,count] of Object.entries(c.manifest))if(records.filter(r=>r.collection===collection).length!==Number(count))throw failure(503,'ข้อมูลยังไม่ครบ กรุณาลองใหม่');
   const list=name=>records.filter(r=>r.collection===name).map(r=>r.body),meta=list('meta')[0]||{};let products=list('products');
   if(role==='stock'){const fields=['id','name','sku','barcode','packBarcode','packSize','category','unit','price','stockOnHand','lowStockAt','enabled','trackStock','image','updatedAt','allocations'];products=products.map(p=>Object.fromEntries(fields.map(k=>[k,p[k]??null])));}
   const snapshot={dashboard:role==='stock'?undefined:meta.dashboard,schema:1,revision:c.revision,products,categories:meta.categories||[],suppliers:role==='stock'?[]:list('suppliers'),purchases:role==='stock'?[]:list('purchases'),movements:role==='stock'?[]:list('movements'),purchaseWorkflowVersion:meta.purchaseWorkflowVersion||0,purchaseOrders:role==='stock'?[]:list('purchaseOrders'),reportPages:role==='stock'?[]:list('reportPages'),reportVersion:meta.reportVersion||0,reportPage:role==='stock'?null:meta.reportPage||null};
   const requests=role==='stock'?[]:await admin('/rest/v1/inventory_central_requests?shop_id=eq.'+shop+'&created_by=eq.'+user.id+'&select=id,type,payload,status,message,created_at,completed_at&order=created_at.desc&limit=1000');
   return reply(200,{role,displayName:staff?.display_name||user.email,snapshot,snapshotAt:c.synced_at,requests,source:'serverjj',devices:c.device_status||[]});
  }
  throw failure(400,'ไม่รองรับคำขอ');
 }catch(e){return reply(e.status||500,{message:e.status?e.message:'ระบบพนักงานไม่พร้อม กรุณาลองใหม่'});}
};}
