import type {ShopSettings} from './office-settings';
import type {TaxMode} from './document-totals';
type DocFields={supplierSnapshot?:Partial<Supplier>;updatedAt?:string;shopSnapshot?:ShopSettings;taxMode?:TaxMode;taxRate?:number;taxAmount?:number;taxableAmount?:number;subtotal?:number;discount?:number;shipping?:number;notes?:string};
export type ReportPage={requestId:string;kind:string;from:string;to:string;generatedAt:string;hash:string;offset:number;totalRows:number;rows:Record<string,string|number|null>[];hasMore:boolean;note:string};
export type PurchaseOrder=DocFields&{id:string;orderNo:string;supplierId:string;supplierName:string;items:{productId:string;name:string;sku:string;quantity:number;received:number;unitCost:number;packCount?:number;piecesPerPack?:number;packCost?:number}[];status:'OPEN'|'PARTIAL'|'RECEIVED'|'CANCELLED';revision:number;total:number;notes:string;expectedDate:string;createdAt:string};
export type Product = {trashedAt?:string|null;trashedBy?:string|null;allocations?:{deviceId:string;label:string;available:number}[];id:string;name:string;sku:string;barcode:string;packBarcode?:string;packSize?:number;category:string;unit:string;price:number;costPrice:number;stockOnHand:number;lowStockAt:number;enabled:boolean;showInQueue?:boolean;trackStock:boolean;image:string;version:string;stockVersion:string;updatedAt:string};
export type Supplier = {id:string;code:string;name:string;phone?:string;contactName?:string;lineId?:string;address?:string;notes?:string;taxId?:string;creditDays?:number;active:boolean;updatedAt?:string};
export type Purchase = DocFields&{status?:string;supplierId?:string;dueDate?:string;paymentMethod?:string;revision?:number;refundReceivable?:number;orderNo?:string;id:string;purchaseNo:string;supplierSnapshot:Partial<Supplier>&{name:string};documentNo:string;total:number;paidAmount:number;balance:number;createdAt:string;items:{sku?:string;packCount?:number;piecesPerPack?:number;packCost?:number;productId?:string;effectiveUnitCost?:number;name:string;quantity:number;unitCost:number;lineTotal:number}[]};
export type Movement = {id:string;productId:string;delta:number;type:string;qtyBefore:number;qtyAfter:number;note:string;documentNo:string;createdAt:string;actor:string};
export type VendingMachine={id:string;name:string;active:boolean;revision:number;cashBalance:number;items:{productId:string;name:string;unit:string;price:number;stock:number;queueDefault?:boolean}[]};
export type Snapshot = {productTrashVersion?:number;vendingWorkflowVersion?:number;employeeWorkflowVersion?:number;vendingMachines?:VendingMachine[];vendingEvents?:Record<string,unknown>[];officeSettings?:ShopSettings;dashboard?:{shifts?:{id:string;employeeName:string;openedAt:string;basketCount:number;basketServiceFee:number}[];date:string;cash:Record<string,number>;queues:Record<string,number>};reportPages?:ReportPage[];reportPage?:ReportPage|null;reportVersion?:number;purchaseOrders?:PurchaseOrder[];purchaseWorkflowVersion?:number;schema:number;revision:number;products:Product[];categories:string[];suppliers:Supplier[];purchases:Purchase[];movements:Movement[]};
export type InventoryRequest = {id:string;type:string;payload:Record<string,unknown>;status:'pending'|'applied'|'rejected';message:string;created_at:string;completed_at:string};
export type DeviceStatus = {id:string;label:string;online:boolean;pending:number};
export type OfficeData = {snapshot:Snapshot|null;snapshotAt:string|null;requests:InventoryRequest[];source?:'pos'|'serverjj';devices?:DeviceStatus[];generation?:string|null;revision?:number};
export type StaffRole='manager'|'employee';
export type StaffUser={pos_ready?:boolean;source?:'pos';user_id:string;username:string;display_name:string;role:StaffRole;active:boolean;created_at:string};

type User={user_id:string;username:string;role:string};
const key='chutima-serverjj-session-v1';
let token:string|null=null,user:User|null=null,cache:OfficeData|null=null;
export function publicKey(){return location.origin;}
export function savePublicKey(value:string){if(value.replace(/\/$/,'')!==location.origin)throw Error('กรุณาเปิดเว็บจากที่อยู่ SERVERJJ โดยตรง');}
async function request<T=unknown>(path:string,body?:unknown):Promise<T>{
 const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store',signal:AbortSignal.timeout(30000)});
 const data=await r.json().catch(()=>null) as {error?:string}|null;if(!r.ok){if(r.status===401){token=null;user=null;cache=null;sessionStorage.removeItem(key);}throw Error(data?.error||'เชื่อมต่อ SERVERJJ ไม่สำเร็จ');}return data as T;
}
export async function needsSetup(){return (await request<{needsSetup:boolean}>('/api/auth/setup-status')).needsSetup;}
export async function login(username:string,password:string,code?:string){const data=await request<{token:string;user:User}>(code?'/api/auth/setup':'/api/auth/login',{username,password,...(code?{code}:{})});token=data.token;user=data.user;cache=null;sessionStorage.setItem(key,token);return user.username;}
export async function restore(){try{token=sessionStorage.getItem(key);if(!token)return null;user=(await request<{user:User}>('/api/auth/me')).user;return user.username;}catch{token=null;user=null;sessionStorage.removeItem(key);return null;}}
export async function logout(){try{if(token)await request('/api/auth/logout',{});}finally{token=null;user=null;cache=null;sessionStorage.removeItem(key);}}
export function draftKey(){return user?'chutima-serverjj-draft:'+user.user_id:null;}
export function currentRole(){return user?.role||'';}
export function canWrite(){return ['owner','manager'].includes(currentRole());}
export const canSeeCost=canWrite;
export function allowedSection(id:string){return canWrite()||currentRole()==='employee'&&id==='products';}
export async function loadOffice():Promise<OfficeData>{const data=await request<OfficeData&{unchanged?:boolean;role:string}>('/api/office'+(cache?'?revision='+cache.revision:''));if(user&&user.role!==data.role){user.role=data.role;cache=null;return loadOffice();}if(data.unchanged&&cache){cache={...cache,...data,snapshot:cache.snapshot};}else cache=data;return cache;}
export async function submit(id:string,type:string,payload:Record<string,unknown>){const r=await request<{status:string;message:string}>('/api/commands',{id,type,payload});cache=null;if(r.status==='rejected')throw Error(r.message);return r;}
export async function listStaff(){return (await request<{users:StaffUser[]}>('/api/staff',{action:'list'})).users;}
export async function createStaff(input:{username:string;displayName:string;role:StaffRole;password:string}){return request('/api/staff',{action:'create',...input});}
export async function updateStaff(input:{userId:string;displayName?:string;role:StaffRole;active:boolean;password?:string}){return request('/api/staff',{action:'update',...input});}
