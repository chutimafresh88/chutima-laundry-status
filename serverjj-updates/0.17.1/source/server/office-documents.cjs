'use strict';
const Legacy=require('./purchase-workflow.cjs'),Core=require('../renderer/inventory-bridge-core.js');
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
function number(v){const n=Number(v??0);if(!Number.isFinite(n)||n<0||n>99999999)throw Error('ยอดเงินไม่ถูกต้อง');return n;}
function totals(p){const subtotal=round(p.items.reduce((n,i)=>n+number(i.quantity)*number(i.unitCost),0)),discount=number(p.discount),shipping=number(p.shipping),taxMode=p.taxMode||'none',taxRate=number(p.taxRate);if(discount>subtotal||taxRate>100||!['none','inclusive','exclusive'].includes(taxMode))throw Error('ส่วนลดหรือ VAT ไม่ถูกต้อง');const amount=round(subtotal-discount+shipping),taxAmount=taxMode==='inclusive'?round(amount-amount/(1+taxRate/100)):taxMode==='exclusive'?round(amount*taxRate/100):0;return {subtotal,discount,shipping,taxMode,taxRate:taxMode==='none'?0:taxRate,taxAmount,taxableAmount:taxMode==='inclusive'?round(amount-taxAmount):amount,total:taxMode==='exclusive'?round(amount+taxAmount):amount};}
function stamp(doc,p,state,t){Object.assign(doc,t,{shopSnapshot:structuredClone(state.officeSettings||{name:'ชุติมา FRESH LAUNDRY'}),notes:String(p.notes||'').slice(0,1000)});const supplier=state.suppliers?.find(s=>s.id===doc.supplierId);if(supplier)doc.supplierSnapshot={code:supplier.code,name:supplier.name,address:supplier.address||'',phone:supplier.phone||'',taxId:supplier.taxId||''};doc.items.forEach(i=>{const line=p.items.find(x=>x.productId===i.productId);if(line?.packCount&&line?.piecesPerPack&&Number(line.packCount)*Number(line.piecesPerPack)===i.quantity)Object.assign(i,{packCount:Number(line.packCount),piecesPerPack:Number(line.piecesPerPack),packCost:number(line.packCost)});});}
function apply(state,command,now=new Date().toISOString()){
 const p=command.payload||{},action=p.workflow;
 if(!['office.settings','order.edit','receipt.edit','receipt.void','order.create','order.receive',undefined].includes(action)){
  if(p.purchaseId&&state.purchases?.find(d=>d.id===p.purchaseId)?.status==='CANCELLED')return {state,result:{id:command.id,status:'rejected',message:'ใบรับสินค้ายกเลิกแล้ว',completedAt:now}};
  return Legacy.apply(state,command,now);
 }
 const old=state.meta?.inventoryBridge?.results?.[command.id];if(old)return {state,result:old,duplicate:true};
 let next=structuredClone(state),message;
 try{
  if(action==='office.settings'){
   if(Number(p.expectedRevision)!==Number(state.officeSettings?.revision||0))throw Error('ข้อมูลร้านเปลี่ยนแล้ว กรุณาโหลดใหม่');const s=p.settings||{};
   if(!String(s.name||'').trim())throw Error('กรุณากรอกชื่อร้าน');if(s.logoUrl&&!/^https:\/\//.test(s.logoUrl))throw Error('ลิงก์โลโก้ต้องเป็น HTTPS');
   totals({items:[],taxMode:s.taxMode,taxRate:s.taxRate});next.officeSettings=Object.fromEntries(['name','address','phone','taxId','branch','logoUrl','footer'].map(k=>[k,String(s[k]||'').trim().slice(0,1000)]));Object.assign(next.officeSettings,{taxMode:s.taxMode||'none',taxRate:number(s.taxRate),revision:Number(state.officeSettings?.revision||0)+1});message='บันทึกข้อมูลร้านและการตั้งค่าเอกสารแล้ว';
  }else if(action==='order.edit'){
   const order=next.purchaseOrders?.find(o=>o.id===p.orderId);if(!order||!['OPEN','PARTIAL'].includes(order.status))throw Error('ใบสั่งซื้อปิดแล้วหรือไม่พบ');if(order.revision!==Number(p.expectedOrderRevision))throw Error('ใบสั่งซื้อเปลี่ยนแล้ว กรุณาโหลดใหม่');
   const candidate=Legacy.apply(next,{...command,payload:{...p,workflow:'order.create'}},now);if(candidate.result.status!=='applied')return candidate;const revised=candidate.state.purchaseOrders[0];
   for(const line of order.items.filter(i=>i.received)){const changed=revised.items.find(i=>i.productId===line.productId);if(!changed||changed.quantity<line.received||changed.unitCost!==line.unitCost)throw Error('สินค้าที่รับแล้วต้องคงราคาเดิม และจำนวนสั่งต้องไม่น้อยกว่ารับสะสม');}
   if(order.items.some(i=>i.received)&&(p.supplierId!==order.supplierId||(p.taxMode||'none')!==(order.taxMode||'none')||number(p.taxRate)!==number(order.taxRate)||number(p.discount)!==number(order.discount)||number(p.shipping)!==number(order.shipping)))throw Error('ใบที่รับบางส่วนแล้วให้คงผู้จำหน่าย VAT ส่วนลด และค่าส่งเดิม');
   const before=structuredClone(order);revised.items.forEach(i=>i.received=order.items.find(x=>x.productId===i.productId)?.received||0);Object.assign(order,{items:revised.items,total:revised.total,supplierId:revised.supplierId,supplierName:revised.supplierName,expectedDate:revised.expectedDate,revision:order.revision+1,updatedAt:now});stamp(order,p,state,totals(p));order.status=order.items.every(i=>i.received===i.quantity)?'RECEIVED':order.items.some(i=>i.received)?'PARTIAL':'OPEN';next.documentHistory||=[];next.documentHistory.push({id:'history_'+command.id,documentId:order.id,before,createdAt:now,reason:String(p.notes||'แก้ไขใบสั่งซื้อ'),deviceId:'SERVERJJ'});message='แก้ไขใบสั่งซื้อแล้ว';
  }else if(action==='receipt.edit'||action==='receipt.void'){
   const doc=next.purchases?.find(d=>d.id===p.purchaseId);if(!doc||doc.status==='CANCELLED')throw Error('ใบรับสินค้าไม่พบหรือยกเลิกแล้ว');if(Number(doc.revision||0)!==Number(p.expectedRevision))throw Error('ใบรับสินค้าเปลี่ยนแล้ว กรุณาโหลดใหม่');if(!String(p.reason||p.notes||'').trim())throw Error('กรุณาระบุเหตุผลแก้ไขหรือยกเลิก');
   if(next.supplierReturns?.some(r=>r.purchaseId===doc.id))throw Error('ใบนี้มีรายการคืนแล้ว กรุณาจัดการผ่านรายการคืนสินค้า');
   const before=structuredClone(doc);
   for(const item of doc.items){const product=next.settings.products[item.productId];if(!product||product.trackStock===false||!Number.isFinite(item.previousAverageCost))throw Error('เอกสารเก่าไม่มีข้อมูลต้นทุนก่อนรับครบ กรุณาใช้รายการคืนสินค้า');
    if(product.stockOnHand!==item.stockAfter||Math.abs(product.costPrice-item.newAverageCost)>0.000001||next.inventoryMovements?.some(m=>m.productId===item.productId&&m.createdAt>doc.createdAt))throw Error('สินค้ามีรายการหลังใบรับนี้แล้ว กรุณาใช้คืนสินค้าแทนเพื่อรักษาต้นทุนย้อนหลัง');
    product.stockOnHand-=item.quantity;if(product.stockOnHand<0)throw Error('สินค้าคงเหลือไม่พอยกเลิก');product.costPrice=item.previousAverageCost;product.updatedAt=now;
    next.inventoryMovements||=[];next.inventoryMovements.push({id:'receipt_reverse_'+command.id+'_'+item.productId,productId:item.productId,delta:-item.quantity,qtyBefore:item.stockAfter,qtyAfter:product.stockOnHand,type:'RECEIPT_REVERSAL',documentNo:doc.purchaseNo,note:String(p.reason||p.notes),createdAt:now,actor:'แก้ไขเอกสารผ่านเว็บ'});
   }
   const order=doc.orderId?next.purchaseOrders?.find(o=>o.id===doc.orderId):null;if(doc.orderId&&!order)throw Error('ไม่พบใบสั่งซื้ออ้างอิง');if(order?.status==='CANCELLED')throw Error('ใบสั่งซื้อปิดแล้ว กรุณาใช้คืนสินค้า');
   if(order){for(const i of doc.items)order.items.find(x=>x.productId===i.productId).received-=i.quantity;}
   if(action==='receipt.void'){doc.status='CANCELLED';doc.cancelReason=String(p.reason);doc.originalTotal=doc.total;doc.total=0;doc.balance=0;doc.refundReceivable=number(doc.paidAmount);doc.revision=Number(doc.revision||0)+1;doc.updatedAt=now;message='ยกเลิกใบรับและย้อนสต๊อกแล้ว';}
   else{
    if(order&&((p.taxMode||'none')!==(order.taxMode||'none')||number(p.taxRate)!==number(order.taxRate)))throw Error('VAT ต้องตรงใบสั่งซื้อ');if(order&&p.supplierId!==order.supplierId)throw Error('ผู้จำหน่ายต้องตรงใบสั่งซื้อ');if(order)for(const i of p.items||[]){const line=order.items.find(x=>x.productId===i.productId);if(!line||number(i.quantity)>line.quantity-line.received)throw Error('จำนวนรับเกินยอดสั่ง');}
    const receipt=apply(next,{...command,payload:{...p,workflow:undefined,paidAmount:0,paymentMethod:'credit'}},now);if(receipt.result.status!=='applied')return {state,result:receipt.result};next=receipt.state;const replacement=next.purchases.find(d=>d.id==='web_purchase_'+command.id);Object.assign(replacement,{id:doc.id,purchaseNo:doc.purchaseNo,orderId:doc.orderId,orderNo:doc.orderNo,revision:Number(doc.revision||0)+1,payments:doc.payments,paidAmount:doc.paidAmount,balance:round(Math.max(0,replacement.total-doc.paidAmount)),refundReceivable:round(Math.max(0,doc.paidAmount-replacement.total)),createdAt:now,originalCreatedAt:doc.originalCreatedAt||doc.createdAt,paymentStatus:doc.paidAmount>=replacement.total?'PAID':doc.paidAmount>0?'PARTIAL':'UNPAID'});next.purchases=next.purchases.filter(d=>d!==next.purchases.find(x=>x.id===doc.id&&x!==replacement));if(order){const target=next.purchaseOrders.find(o=>o.id===order.id);for(const i of replacement.items)target.items.find(x=>x.productId===i.productId).received+=i.quantity;}message='แก้ไขใบรับสินค้าและต้นทุนแล้ว';
   }
   if(order){const target=next.purchaseOrders.find(o=>o.id===order.id);target.status=target.items.every(i=>i.received===i.quantity)?'RECEIVED':target.items.some(i=>i.received)?'PARTIAL':'OPEN';target.revision++;target.updatedAt=now;}
   next.documentHistory||=[];next.documentHistory.push({id:'history_'+command.id,documentId:doc.id,before,reason:String(p.reason||p.notes),createdAt:now,deviceId:'SERVERJJ'});
  }else{
   const order=action==='order.receive'?state.purchaseOrders?.find(o=>o.id===p.orderId):null;
   const payload={...p,...(order?{taxMode:order.taxMode||'none',taxRate:order.taxRate||0}:{})};
   if(!Array.isArray(payload.items))throw Error('กรุณาระบุสินค้า');const t=totals(payload);const wrapped={...command,payload:{...payload,shipping:t.shipping+(t.taxMode==='exclusive'?t.taxAmount:0)}};
   const result=Legacy.apply(state,wrapped,now);if(result.result.status!=='applied')return result;
   const doc=action==='order.create'?result.state.purchaseOrders.find(o=>o.id==='order_'+command.id):result.state.purchases.find(d=>d.id==='web_purchase_'+command.id);stamp(doc,payload,state,t);if(action!=='order.create')doc.purchaseNo=doc.purchaseNo.replace(/^PO-W-/,'GR-');return result;
  }
  const result={id:command.id,status:'applied',message,completedAt:now};next.meta||={};next.meta.inventoryBridge||={};next.meta.inventoryBridge.results||={};next.meta.inventoryBridge.results[command.id]=result;next.auditLogs||=[];next.auditLogs.push({id:'office_audit_'+command.id,action:'WEB_DOCUMENT',createdAt:now,details:{workflow:action,message}});return {state:next,result};
 }catch(e){return {state,result:{id:command.id,status:'rejected',message:e.message,completedAt:now}};}
}
module.exports={apply,totals};
