import { defaultPublishableKey } from './cloud-config';
export const cloudUrl = 'https://dgvdwdmaxvtfnjiiixcm.supabase.co';
export type Product = {id:string;name:string;sku:string;barcode:string;category:string;unit:string;price:number;costPrice:number;stockOnHand:number;lowStockAt:number;enabled:boolean;trackStock:boolean;image:string;version:string;stockVersion:string;updatedAt:string};
export type Supplier = {id:string;code:string;name:string;phone?:string;contactName?:string;lineId?:string;address?:string;notes?:string;taxId?:string;creditDays?:number;active:boolean;updatedAt?:string};
export type Purchase = {id:string;purchaseNo:string;supplierSnapshot:{name:string};documentNo:string;total:number;paidAmount:number;balance:number;createdAt:string;items:{name:string;quantity:number;unitCost:number;lineTotal:number}[]};
export type Movement = {id:string;productId:string;delta:number;type:string;qtyBefore:number;qtyAfter:number;note:string;documentNo:string;createdAt:string;actor:string};
export type Snapshot = {schema:number;revision:number;products:Product[];categories:string[];suppliers:Supplier[];purchases:Purchase[];movements:Movement[]};
export type InventoryRequest = {id:string;type:string;payload:Record<string,unknown>;status:'pending'|'applied'|'rejected';message:string;created_at:string;completed_at:string};
export type DeviceStatus = {id:string;label:string;online:boolean;pending:number};
export type OfficeData = {snapshot:Snapshot|null;snapshotAt:string|null;requests:InventoryRequest[];source?:'pos'|'serverjj';devices?:DeviceStatus[]};
type CentralStatus = {active:boolean;generation:string|null;revision:number;manifest:Record<string,number>;device_status:DeviceStatus[];synced_at:string|null};
type CentralRow = {collection:'products'|'suppliers'|'purchases'|'movements'|'meta';id:string;body:Record<string,unknown>};
type Session = {access_token:string;refresh_token:string;expires_at:number;email:string};
type Member = {user_id:string;shop_id:string;role:string};
type AuthReply = {access_token:string;refresh_token:string;expires_in:number};
const sessionKey='chutima-office-session-v1',keyName='chutima-office-public-key';
let session:Session|null=null,member:Member|null=null,refreshing:Promise<void>|null=null;
let centralCache:{shop:string;generation:string;revision:number;snapshot:Snapshot}|null=null;
export function publicKey(){try{return localStorage.getItem(keyName)||defaultPublishableKey;}catch{return defaultPublishableKey;}}
export function savePublicKey(key:string){if(!/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key.trim()))throw Error('กรุณาตรวจ Publishable key ที่ขึ้นต้น sb_publishable_');localStorage.setItem(keyName,key.trim());}
function remember(value:Session){session=value;sessionStorage.setItem(sessionKey,JSON.stringify(value));}
async function raw<T=unknown>(path:string,options:RequestInit={},token:string|null=null):Promise<T>{
  const response=await fetch(cloudUrl+path,{...options,headers:{apikey:publicKey(),'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...options.headers},signal:AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok){const failure=data as {message?:string;error_description?:string}|null;const message=response.status===404?'ยังไม่ได้ติดตั้งตารางหลังบ้านใน Supabase':failure?.message||failure?.error_description||'เชื่อมต่อไม่สำเร็จ กรุณาลองอีกครั้ง';throw Object.assign(Error(message),{status:response.status});}
  return data as T;
}
async function refresh(){
  if(refreshing)return refreshing;
  refreshing=(async()=>{if(!session)throw Error('กรุณาเข้าสู่ระบบ');const data=await raw<AuthReply>('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})});remember({...session,access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Date.now()+Number(data.expires_in||1800)*1000});})().finally(()=>refreshing=null);
  return refreshing;
}
async function request<T=unknown>(path:string,options:RequestInit={}):Promise<T>{
  if(!session)throw Error('กรุณาเข้าสู่ระบบ');
  if(session.expires_at<Date.now()+60000)await refresh();
  try{return await raw<T>(path,options,session.access_token);}catch(error){if((error as {status?:number}).status===401){await refresh();return raw<T>(path,options,session!.access_token);}throw error;}
}
async function getMember(){const rows=await request<Member[]>('/rest/v1/inventory_members?select=user_id,shop_id,role');if(rows.length!==1||rows[0].role!=='owner')throw Error('บัญชีนี้ยังไม่ได้รับสิทธิ์เจ้าของร้าน กรุณาตั้งค่าสิทธิ์ใน Supabase ก่อน');member=rows[0];return member!;}
export async function login(email:string,password:string){
  if(!publicKey())throw Error('กรุณาตั้งค่าการเชื่อมต่อก่อนเข้าสู่ระบบ');
  const data=await raw<AuthReply>('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:email.trim(),password})});
  remember({access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Date.now()+Number(data.expires_in||1800)*1000,email:email.trim()});
  try{await getMember();return session!.email;}catch(error){await logout();throw error;}
}
export async function restore(){
  try{const saved=sessionStorage.getItem(sessionKey);if(!saved)return null;session=JSON.parse(saved);await getMember();return session?.email||null;}catch{session=null;member=null;sessionStorage.removeItem(sessionKey);return null;}
}
export async function logout(){const token=session?.access_token;session=null;member=null;centralCache=null;sessionStorage.removeItem(sessionKey);if(token)await raw('/auth/v1/logout?scope=local',{method:'POST'},token).catch(()=>{});}
async function centralStatus(shop:string):Promise<CentralStatus|null>{
  try{return (await request<CentralStatus[]>(`/rest/v1/inventory_central?shop_id=eq.${shop}&select=active,generation,revision,manifest,device_status,synced_at`))[0]||null;}
  catch(error){if((error as {status?:number}).status===404)return null;throw error;}
}
async function centralSnapshot(shop:string,status:CentralStatus):Promise<Snapshot>{
  if(!status.generation||!/^[a-f0-9-]{36}$/i.test(status.generation))throw Error('ข้อมูลจาก SERVERJJ ยังไม่ครบ กรุณาอัปเดตอีกครั้ง');
  if(centralCache?.shop===shop&&centralCache.generation===status.generation&&centralCache.revision===Number(status.revision))return centralCache.snapshot;
  const counts:Record<string,number>={products:0,suppliers:0,purchases:0,movements:0,meta:0};
  for(const key of Object.keys(counts))if(!Number.isSafeInteger(status.manifest[key])||status.manifest[key]<0)throw Error('รายการข้อมูลจาก SERVERJJ ไม่ถูกต้อง');
  const rows:CentralRow[]=[];let offset=0;
  // A publication is immutable. A generation switch during paging is retried
  // from its new manifest instead of showing a mixture of different snapshots.
  const expected=Object.values(status.manifest).reduce((n,count)=>n+count,0);
  if(expected>100000||status.manifest.meta!==1)throw Error('รายการข้อมูลจาก SERVERJJ ไม่ถูกต้อง');
  while(offset<expected){
    const page=await request<CentralRow[]>(`/rest/v1/inventory_central_rows?shop_id=eq.${shop}&generation=eq.${status.generation}&select=collection,id,body&order=collection.asc,id.asc&offset=${offset}&limit=200`);
    if(!page.length)break;
    rows.push(...page);offset+=page.length;
  }
  const seen=new Set<string>();
  for(const row of rows){const key=row.collection+'/'+row.id;if(!(row.collection in counts)||seen.has(key))throw Error('ข้อมูลจาก SERVERJJ ไม่ครบ กรุณาอัปเดตอีกครั้ง');seen.add(key);counts[row.collection]++;}
  if(Object.keys(counts).some(k=>counts[k]!==status.manifest[k]))throw Error('ข้อมูลจาก SERVERJJ ไม่ครบ กรุณาอัปเดตอีกครั้ง');
  const list=(collection:CentralRow['collection'])=>rows.filter(r=>r.collection===collection).map(r=>r.body);
  const snapshot:Snapshot={schema:1,revision:Number(status.revision),products:list('products') as Product[],suppliers:list('suppliers') as Supplier[],purchases:list('purchases') as Purchase[],movements:list('movements') as Movement[],categories:(list('meta')[0].categories||[]) as string[]};
  snapshot.purchases.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
  snapshot.movements.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
  centralCache={shop,generation:status.generation,revision:Number(status.revision),snapshot};return snapshot;
}
export async function loadOffice():Promise<OfficeData>{
  const m=member||await getMember();
  let central=await centralStatus(m.shop_id);
  if(central?.active){
    let snapshot:Snapshot;
    try{snapshot=await centralSnapshot(m.shop_id,central);}catch(error){
      const latest=await centralStatus(m.shop_id);
      if(!latest?.active||latest.generation===central.generation)throw error;
      central=latest;snapshot=await centralSnapshot(m.shop_id,central);
    }
    const requests=await request<InventoryRequest[]>(`/rest/v1/inventory_central_requests?shop_id=eq.${m.shop_id}&order=created_at.desc,id.desc&limit=1000&select=id,type,payload,status,message,created_at,completed_at`);
    return {snapshot,snapshotAt:central.synced_at,requests,source:'serverjj',devices:central.device_status||[]};
  }
  const [snapshots,requests]=await Promise.all([request<{snapshot:Snapshot;synced_at:string}[]>(`/rest/v1/inventory_snapshots?shop_id=eq.${m.shop_id}&select=snapshot,synced_at`),request<InventoryRequest[]>(`/rest/v1/inventory_requests?shop_id=eq.${m.shop_id}&order=created_at.desc,id.desc&limit=1000&select=id,type,payload,status,message,created_at,completed_at`)]);
  return {snapshot:snapshots[0]?.snapshot||null,snapshotAt:snapshots[0]?.synced_at||null,requests,source:'pos',devices:[]};
}
const canonical=(value:unknown):string=>value&&typeof value==='object'?Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')}}`:JSON.stringify(value);
export async function submit(id:string,type:string,payload:Record<string,unknown>){
  const m=member||await getMember();
  const row={id,shop_id:m.shop_id,created_by:m.user_id,type,payload,status:'pending'};
  const central=await centralStatus(m.shop_id),table=central?.active?'inventory_central_requests':'inventory_requests';
  try{await request('/rest/v1/'+table,{method:'POST',body:JSON.stringify(row)});}catch(error){
    if((error as {status?:number}).status!==409)throw error;
    const prior=await request<Pick<InventoryRequest,'id'|'type'|'payload'>[]>(`/rest/v1/${table}?id=eq.${id}&shop_id=eq.${m.shop_id}&select=id,type,payload`);
    if(prior.length!==1||prior[0].type!==type||canonical(prior[0].payload)!==canonical(payload))throw Error('เลขรายการซ้ำกับข้อมูลอื่น กรุณาปิดฟอร์มแล้วลองใหม่');
  }
}
