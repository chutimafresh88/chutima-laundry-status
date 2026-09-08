// The browser never receives or supplies a service key. Machine access is
// scoped to the one shop registered by an authenticated owner.
const uuid=value=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value||'');
const hash=value=>/^[0-9a-f]{64}$/.test(value||'');
const fail=(status,message)=>Object.assign(Error(message),{status});
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;};
async function sha(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function envKey(env,name,fallback,prefix){
  try{const keys=JSON.parse(env(name)||'{}');const key=Object.values(keys).find(v=>typeof v==='string'&&v.startsWith(prefix));if(key)return key;}catch{}
  return env(fallback)||'';
}
async function readBody(request){
  const reader=request.body?.getReader();if(!reader)throw fail(400,'ไม่มีข้อมูลรายการ');const parts=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576){await reader.cancel();throw fail(413,'รายการใหญ่เกินกำหนด');}parts.push(value);}
  const body=new Uint8Array(size);let offset=0;for(const part of parts){body.set(part,offset);offset+=part.length;}
  try{return JSON.parse(new TextDecoder().decode(body));}catch{throw fail(400,'รูปแบบรายการไม่ถูกต้อง');}
}
export function createHandler({env,fetchImpl=fetch,now=()=>new Date().toISOString()}){
  return async request=>{
    const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    try{
      if(request.method!=='POST')throw fail(405,'ใช้การส่งรายการจาก SERVERJJ');
      if(request.headers.has('Origin'))throw fail(403,'เชื่อมต่อผ่านโปรแกรมที่ลงทะเบียนแล้ว');
      if(!/^application\/json\b/i.test(request.headers.get('content-type')||''))throw fail(400,'รูปแบบรายการไม่ถูกต้อง');
      const input=await readBody(request);
      if(!input||typeof input!=='object'||!uuid(input.serverId))throw fail(400,'ข้อมูลเซิร์ฟเวอร์ไม่ถูกต้อง');
      const url=env('SUPABASE_URL'),service=envKey(env,'SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY','sb_secret_');
      const publishable=envKey(env,'SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY','sb_publishable_');
      if(!url||!service||!publishable)throw fail(503,'ระบบเชื่อมต่อยังไม่พร้อม');
      const adminHeaders={apikey:service,...(!service.startsWith('sb_secret_')?{Authorization:'Bearer '+service}:{}),'Content-Type':'application/json'};
      async function admin(path,{method='GET',body,headers={}}={}){
        const response=await fetchImpl(url+path,{method,headers:{...adminHeaders,...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw fail(response.status===409?409:502,'บันทึกข้อมูลเชื่อมต่อไม่สำเร็จ กรุณาลองอีกครั้ง');
        return response.status===204?null:response.json().catch(()=>null);
      }
      if(input.action==='register'){
        if(!hash(input.keyHash))throw fail(400,'ข้อมูลลงทะเบียนไม่ถูกต้อง');
        const authorization=request.headers.get('Authorization');
        if(!authorization?.startsWith('Bearer '))throw fail(401,'กรุณาใช้บัญชีเจ้าของร้านที่เข้าสู่ระบบแล้ว');
        const auth=await fetchImpl(url+'/auth/v1/user',{headers:{apikey:publishable,Authorization:authorization},signal:AbortSignal.timeout(15000)});
        if(!auth.ok)throw fail(401,'บัญชีเจ้าของร้านหมดเวลาเข้าสู่ระบบ');
        const user=await auth.json();if(!uuid(user.id))throw fail(401,'บัญชีเจ้าของร้านไม่ถูกต้อง');
        const members=await admin('/rest/v1/inventory_members?user_id=eq.'+user.id+'&select=shop_id,role');
        if(members?.length!==1||members[0].role!=='owner')throw fail(403,'บัญชีนี้ไม่มีสิทธิ์เจ้าของร้าน');
        const shop=members[0].shop_id;
        let rows=await admin('/rest/v1/inventory_central?shop_id=eq.'+shop+'&select=server_id,key_hash,active');
        if(!rows.length){
          try{await admin('/rest/v1/inventory_central',{method:'POST',body:{shop_id:shop,server_id:input.serverId,key_hash:input.keyHash}});}catch(error){if(error.status!==409)throw error;}
          rows=await admin('/rest/v1/inventory_central?shop_id=eq.'+shop+'&select=server_id,key_hash,active');
        }
        if(rows.length!==1||rows[0].server_id!==input.serverId||!equal(rows[0].key_hash,input.keyHash))throw fail(409,'ร้านนี้ลงทะเบียน SERVERJJ ไว้แล้ว กรุณาใช้การเชื่อมต่อเดิม');
        return reply(200,{registered:true,shopId:shop,serverId:input.serverId,active:rows[0].active});
      }
      const key=request.headers.get('X-Chutima-Key');
      if(!/^[A-Za-z0-9_-]{43,128}$/.test(key||''))throw fail(401,'เซิร์ฟเวอร์ยังไม่ได้รับสิทธิ์');
      const keyHash=await sha(key);
      const rows=await admin('/rest/v1/inventory_central?server_id=eq.'+input.serverId+'&select=shop_id,server_id,key_hash,active,revision,generation');
      const central=rows?.[0];if(rows?.length!==1||!equal(central.key_hash,keyHash))throw fail(401,'เซิร์ฟเวอร์ยังไม่ได้รับสิทธิ์');
      const args={p_shop:central.shop_id,p_server:input.serverId,p_key_hash:keyHash};
      if(input.action==='exchange'){
        if(!Array.isArray(input.devices)||input.devices.length>2)throw fail(400,'สถานะเครื่องไม่ถูกต้อง');
        const devices=input.devices.map(d=>{
          if(!/^[A-Za-z0-9_-]{1,160}$/.test(d.id||'')||!Number.isSafeInteger(d.pending)||d.pending<0||d.pending>9999999)throw fail(400,'สถานะเครื่องไม่ถูกต้อง');
          return {id:d.id,label:String(d.label||'POS').slice(0,80),online:d.online===true,pending:d.pending};
        });
        await admin('/rest/v1/inventory_central?server_id=eq.'+input.serverId,{method:'PATCH',body:{device_status:devices,...(central.active?{synced_at:now()}:{})}});
        const commands=central.active?await admin('/rest/v1/inventory_central_requests?shop_id=eq.'+central.shop_id+'&status=eq.pending&order=created_at.asc,id.asc&limit=50&select=id,type,payload,created_at'):[];
        return reply(200,{active:central.active,revision:Number(central.revision),generation:central.generation,commands});
      }
      if(input.action==='stage'){
        if(!uuid(input.generation)||!Array.isArray(input.records)||input.records.length>200)throw fail(400,'หน้าข้อมูลไม่ถูกต้อง');
        await admin('/rest/v1/rpc/inventory_central_stage',{method:'POST',body:{...args,p_generation:input.generation,p_records:input.records}});
      }else if(input.action==='publish'){
        if(!uuid(input.generation)||!Number.isSafeInteger(input.revision)||input.revision<1)throw fail(400,'รุ่นข้อมูลไม่ถูกต้อง');
        await admin('/rest/v1/rpc/inventory_central_publish',{method:'POST',body:{...args,p_generation:input.generation,p_revision:input.revision,p_manifest:input.manifest}});
      }else if(input.action==='progress'){
        if(!uuid(input.id))throw fail(400,'ผลรายการไม่ถูกต้อง');
        await admin('/rest/v1/inventory_central_requests?shop_id=eq.'+central.shop_id+'&id=eq.'+input.id+'&status=eq.pending',{method:'PATCH',body:{message:String(input.message||'').slice(0,500)}});
      }else if(input.action==='result'){
        if(!uuid(input.id)||!['applied','rejected'].includes(input.status))throw fail(400,'ผลรายการไม่ถูกต้อง');
        await admin('/rest/v1/rpc/inventory_central_result',{method:'POST',body:{...args,p_id:input.id,p_status:input.status,p_message:String(input.message||'').slice(0,500)}});
      }else throw fail(400,'ไม่รองรับรายการนี้');
      return reply(200,{ok:true});
    }catch(error){return reply(error.status||503,{error:error.status?error.message:'เชื่อมต่อไม่สำเร็จ ระบบจะลองใหม่อัตโนมัติ'});}
  };
}
