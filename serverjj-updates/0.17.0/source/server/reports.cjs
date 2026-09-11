'use strict';
const Model=require('../central/model.cjs');
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const day=v=>{const d=new Date(v);return Number.isFinite(+d)?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(d):'';};
function build(state,input,now=new Date().toISOString()){
 const {kind,from,to}=input;if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(to||'')||from>to||new Date(from+'T00:00:00Z').toISOString().slice(0,10)!==from||new Date(to+'T00:00:00Z').toISOString().slice(0,10)!==to)throw Error('เลือกช่วงวันที่ให้ถูกต้อง');
 const within=v=>{const d=day(v);return d>=from&&d<=to;},who=id=>state.employees?.find(e=>e.id===id)?.name||id||'',allowed=r=>(!input.deviceId||r.deviceId===input.deviceId)&&(!input.employeeId||r.employeeId===input.employeeId);
 let rows=[],note='ข้อมูลที่ SERVERJJ ได้รับแล้ว อาจยังไม่รวมรายการจากเครื่องออฟไลน์';
 const queues=(state.queues||[]),sales=(state.productSales||[]),returns=state.productReturns||[];
 if(kind==='sales'){
  for(const [docs,sign,label] of [[sales,1,'ขาย'],[returns,-1,'คืน']])for(const doc of docs.filter(r=>within(r.createdAt)&&allowed(r)))for(const i of doc.items||[]){const cost=i.unitCost==null?null:n(i.unitCost);rows.push({'วันที่':day(doc.createdAt),'เลขบิล':String(doc.saleNo||doc.returnNo||doc.id),'ประเภท':label,'สินค้า':i.label||i.name||i.productId,'จำนวน':sign*n(i.quantity),'ยอดสินค้า':sign*n(i.amount),'ต้นทุนตอนขาย/ชิ้น':cost,'กำไรขั้นต้นก่อนส่วนลดระดับบิล':cost===null?null:sign*(n(i.amount)-cost*n(i.quantity)),'พนักงาน':who(doc.employeeId),'เครื่อง':doc.deviceId||''});}
  note+=' · กำไรช่องว่างหมายถึงไม่มีต้นทุนย้อนหลัง ไม่ใช้ต้นทุนปัจจุบันแทน';
 }else if(kind==='laundry'){
  rows=queues.filter(q=>within(q.createdAt)&&allowed(q)).map(q=>{const total=n(q.pricing?.total)+(q.extras||[]).reduce((s,e)=>s+n(e.amount),0),paid=(q.payments||[]).reduce((s,p)=>s+n(p.amount),0);return {'วันที่รับงาน':day(q.createdAt),'คิว':String(q.queueNo||q.id),'ลูกค้า':q.customerName||'','บริการ':(q.baskets||[]).map(b=>b.serviceType||'').join(', '),'สถานะ':q.status,'ยอดตามบิล':total,'รับสุทธิสะสม':paid,'ค้างรับ':q.status==='CANCELLED'?0:Math.max(0,total-paid),'จำนวนตะกร้า':q.baskets?.length||1,'พนักงาน':who(q.employeeId),'เครื่อง':q.deviceId||''};});
  note+=' · ยอดรับสะสมของคิวอาจรับเงินคนละวันกับวันฝากซัก';
 }else if(kind==='cash'||kind==='overview'){
  const all=[];for(const q of queues)for(const p of q.payments||[])all.push({...p,deviceId:q.deviceId,employeeId:p.employeeId||q.employeeId,source:'งานซัก',ref:String(q.queueNo||q.id)});
  for(const s of sales)if(s.payment)all.push({...s.payment,createdAt:s.payment.createdAt||s.createdAt,deviceId:s.deviceId,employeeId:s.employeeId,source:'ขายสินค้า',ref:String(s.saleNo||s.id)});
  for(const r of returns)if(r.payment)all.push({...r.payment,createdAt:r.payment.createdAt||r.createdAt,deviceId:r.deviceId,employeeId:r.employeeId,source:'คืนสินค้า',ref:String(r.returnNo||r.id)});
  const filtered=all.filter(p=>within(p.createdAt)&&allowed(p));
  if(kind==='cash')rows=filtered.map(p=>({'วันที่รับ/คืนเงินจริง':day(p.createdAt),'อ้างอิง':p.ref,'ประเภท':p.source,'ช่องทาง':p.method,'จำนวนเงิน':n(p.amount),'พนักงาน':who(p.employeeId),'เครื่อง':p.deviceId||''}));
  else{const days=new Map();for(const p of filtered){const d=day(p.createdAt),r=days.get(d)||{'วันที่':d,'รับสุทธิงานซัก':0,'รับสุทธิสินค้า':0,'เงินสดสุทธิ':0,'โอนสุทธิ':0,'เงินรับสุทธิรวม':0};r[p.source==='งานซัก'?'รับสุทธิงานซัก':'รับสุทธิสินค้า']+=n(p.amount);if(p.method==='cash')r['เงินสดสุทธิ']+=n(p.amount);if(p.method==='qr')r['โอนสุทธิ']+=n(p.amount);r['เงินรับสุทธิรวม']+=n(p.amount);days.set(d,r);}rows=[...days.values()].sort((a,b)=>a['วันที่'].localeCompare(b['วันที่']));}
 }else if(kind==='stock'){
  rows=Object.values(state.settings?.products||{}).map(p=>({'สินค้า':p.name,'รหัสสินค้า':p.sku,'บาร์โค้ดชิ้น':p.barcode||'','บาร์โค้ดแพ็ก':p.packBarcode||'','ชิ้นต่อแพ็ก':p.packSize||1,'คงเหลือทั้งร้าน':n(p.stockOnHand),'ต้นทุนเฉลี่ย/ชิ้น':n(p.costPrice),'มูลค่าคงเหลือ':n(p.stockOnHand)*n(p.costPrice),'ราคาขาย':n(p.price),'ใกล้หมด':n(p.stockOnHand)<=n(p.lowStockAt)?'ใช่':'ไม่'}));note+=' · สต๊อกปัจจุบัน ณ เวลาสร้างรายงาน ไม่ใช่สต๊อกย้อนหลัง';
 }else if(kind==='movements')rows=(state.inventoryMovements||[]).filter(m=>within(m.createdAt)).map(m=>({'วันที่':day(m.createdAt),'สินค้า':state.settings?.products?.[m.productId]?.name||m.productId,'ประเภท':m.type,'ก่อน':n(m.qtyBefore),'เปลี่ยนแปลง':n(m.delta),'หลัง':n(m.qtyAfter),'เอกสาร':m.documentNo||m.sourceId||'','เหตุผล':m.note||''}));
 else if(kind==='purchases')rows=(state.purchases||[]).filter(p=>within(p.createdAt)).map(p=>({'วันที่':day(p.createdAt),'เอกสาร':p.purchaseNo,'ผู้จำหน่าย':p.supplierSnapshot?.name||'','ยอดซื้อ':n(p.total),'จ่ายแล้ว':n(p.paidAmount),'เครดิตคืนสินค้า':n(p.supplierCreditTotal),'เงินรอรับคืนจากผู้จำหน่าย':n(p.refundReceivable),'ค้างชำระ':n(p.balance),'ครบกำหนด':p.dueDate||''}));
 else if(kind==='shifts')rows=(state.shifts||[]).filter(s=>within(s.openedAt)&&allowed(s)).map(s=>({'วันเปิดกะ':day(s.openedAt),'เปิดกะ':s.openedAt,'ปิดกะ':s.closedAt||'','พนักงาน':who(s.employeeId),'สถานะ':s.status,'เงินตั้งต้น':n(s.openingFloat),'เงินที่ควรมี':s.expectedCash??null,'นับจริง':s.countedCash??null,'ขาด/เกิน':s.variance??null,'เครื่อง':s.deviceId||''}));
 else if(kind==='customers'){
  const map=new Map();for(const q of queues.filter(q=>within(q.createdAt)&&q.status!=='CANCELLED')){const key=q.customerId||q.customerPhone||q.customerName||q.id,r=map.get(key)||{'ลูกค้า':q.customerName||'ไม่ระบุชื่อ','จำนวนครั้ง':0,'ยอดตามบิล':0,'ใช้บริการล่าสุด':''};r['จำนวนครั้ง']++;r['ยอดตามบิล']+=n(q.pricing?.total)+(q.extras||[]).reduce((s,e)=>s+n(e.amount),0);r['ใช้บริการล่าสุด']=[r['ใช้บริการล่าสุด'],day(q.createdAt)].sort().at(-1);map.set(key,r);}rows=[...map.values()].sort((a,b)=>b['จำนวนครั้ง']-a['จำนวนครั้ง']);
 }else if(kind==='audit')rows=(state.auditLogs||[]).filter(a=>a.action!=='WEB_REPORT'&&within(a.createdAt)).map(a=>({'วันที่':day(a.createdAt),'เวลา':a.createdAt,'การทำรายการ':a.action,'อ้างอิง':a.queueId||a.entityId||'','ผู้ทำ':a.actor||a.employeeId||'','เหตุผล/ผล':a.details?.message||a.details?.reason||''}));
 else throw Error('ไม่พบประเภทรายงาน');
 const hash=Model.hash(rows);if(input.expectedHash&&input.expectedHash!==hash)throw Error('ข้อมูลรายงานเปลี่ยนระหว่างส่งออก กรุณาสร้างรายงานใหม่');
 const offset=n(input.offset);if(!Number.isSafeInteger(offset)||offset<0||offset>rows.length)throw Error('หน้ารายงานไม่ถูกต้อง');
 const page=rows.slice(offset,offset+100);return {kind,from,to,generatedAt:now,hash,offset,totalRows:rows.length,rows:page,hasMore:offset+page.length<rows.length,note};
}
module.exports={build};
