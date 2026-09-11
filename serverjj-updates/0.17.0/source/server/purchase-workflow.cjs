'use strict';
const Core=require('../renderer/inventory-bridge-core.js');
const Reports=require('./reports.cjs');
const clean=v=>String(v??'').trim().slice(0,240);
function num(v,label,integer=false){const n=Number(v);if(v==null||v===''||!Number.isFinite(n)||n<0||n>99999999||(integer&&(!Number.isSafeInteger(n)||n>9999999)))throw Error(label+'ไม่ถูกต้อง');return n;}
function apply(state,command,now=new Date().toISOString()){
 const action=command.payload?.workflow;
 if(!action)return Core.apply(state,command,now);
 const previous=state.meta?.inventoryBridge?.results?.[command.id];if(previous)return {state,result:previous,duplicate:true};
 const next=structuredClone(state),p=command.payload;next.purchaseOrders||=[];
 try{
  if(!['order.create','order.receive','order.cancel','report.prepare','purchase.pay','purchase.return'].includes(action))throw Error('ไม่รองรับขั้นตอนจัดซื้อ');
  let message;
  if(action==='report.prepare'){
   next.reportPage={...Reports.build(state,p,now),requestId:command.id,id:command.id};next.reportPages=[...(state.reportPages||[]).filter(x=>new Date(now)-new Date(x.generatedAt)<600000),next.reportPage].slice(-10);message='สร้างรายงานแล้ว';
  }else if(action==='purchase.pay'||action==='purchase.return'){
   const doc=next.purchases?.find(d=>d.id===p.purchaseId);if(!doc)throw Error('ไม่พบเอกสารรับสินค้า');
   if(Number(p.expectedRevision)!==Number(doc.revision||0))throw Error('เอกสารเปลี่ยนแล้ว กรุณาโหลดใหม่');
   if(action==='purchase.pay'){
    const amount=num(p.amount,'ยอดจ่าย');if(!amount||amount>num(doc.balance,'ค้างชำระ'))throw Error('ยอดจ่ายเกินยอดค้าง หรือเป็นศูนย์');
    if(!['cash','qr'].includes(p.paymentMethod))throw Error('เลือกช่องทางชำระ');
    doc.payments||=[];doc.payments.push({id:'web_payment_'+command.id,amount,method:p.paymentMethod,paidAt:now,createdAt:now,note:clean(p.notes),shiftId:null,employeeId:null});
    doc.paidAmount=num(doc.paidAmount||0,'จ่ายแล้ว')+amount;message='บันทึกชำระหนี้แล้ว (นอกลิ้นชัก POS)';
   }else{
    const product=next.settings?.products?.[p.productId],item=doc.items?.find(i=>i.productId===p.productId);if(!product||!item||product.trackStock===false)throw Error('ไม่พบสินค้าในใบรับหรือไม่ได้ติดตามสต๊อก');
    const qty=num(p.quantity,'จำนวนคืน',true);next.supplierReturns||=[];
    const returned=next.supplierReturns.filter(r=>r.purchaseId===doc.id&&r.productId===p.productId).reduce((sum,r)=>sum+r.quantity,0);
    if(!qty||qty>item.quantity-returned||qty>num(product.stockOnHand,'สต๊อก'))throw Error('จำนวนคืนเกินยอดรับที่ยังคืนได้ หรือเกินสต๊อก');
    if(!clean(p.notes))throw Error('ระบุเหตุผลคืนสินค้า');
    const credit=num(p.creditAmount,'ยอดลดหนี้');if(credit>num(item.effectiveUnitCost??item.unitCost,'ต้นทุน')*qty+0.01)throw Error('ยอดลดหนี้เกินมูลค่าสินค้าที่คืน');
    const before=product.stockOnHand;product.stockOnHand-=qty;product.updatedAt=now;
    const record={id:'supplier_return_'+command.id,purchaseId:doc.id,productId:p.productId,quantity:qty,creditAmount:credit,note:clean(p.notes),createdAt:now,deviceId:'SERVERJJ'};next.supplierReturns.unshift(record);
    next.inventoryMovements||=[];next.inventoryMovements.unshift({id:'supplier_return_move_'+command.id,productId:p.productId,delta:-qty,qtyBefore:before,qtyAfter:product.stockOnHand,unitCost:product.costPrice,type:'SUPPLIER_RETURN',documentNo:doc.purchaseNo,note:record.note,createdAt:now,actor:'เจ้าของร้านผ่านเว็บ'});
    doc.supplierCreditTotal=num(doc.supplierCreditTotal||0,'ลดหนี้')+credit;message='คืนสินค้าและบันทึกลดหนี้แล้ว';
   }
   doc.balance=Math.max(0,Math.round((doc.total-doc.paidAmount-(doc.supplierCreditTotal||0))*100)/100);doc.refundReceivable=Math.max(0,doc.paidAmount+(doc.supplierCreditTotal||0)-doc.total);doc.paymentStatus=doc.balance===0?'PAID':'PARTIAL';doc.revision=Number(doc.revision||0)+1;doc.updatedAt=now;
  }else if(action==='order.create'){
   const supplier=next.suppliers?.find(s=>s.id===p.supplierId&&s.active!==false);if(!supplier)throw Error('กรุณาเลือกผู้จำหน่าย');
   if(!Array.isArray(p.items)||!p.items.length||p.items.length>100)throw Error('กรุณาระบุรายการสั่งซื้อ');
   if(new Set(p.items.map(i=>i.productId)).size!==p.items.length)throw Error('สินค้าซ้ำ');
   const items=p.items.map(i=>{const product=next.settings?.products?.[i.productId];if(!product||product.enabled===false)throw Error('ไม่พบสินค้าที่เปิดใช้งาน');const quantity=num(i.quantity,'จำนวน',true),unitCost=num(i.unitCost,'ต้นทุน');if(!quantity)throw Error('จำนวนต้องมากกว่า 0');return {productId:product.id,name:product.name,sku:product.sku,quantity,received:0,unitCost};});
   const total=items.reduce((sum,i)=>sum+i.quantity*i.unitCost,0);num(total,'ยอดสั่งซื้อ');
   const order={id:'order_'+command.id,orderNo:'PO-'+now.slice(0,10).replaceAll('-','')+'-'+command.id.slice(0,8).toUpperCase(),supplierId:supplier.id,supplierName:supplier.name,items,total,status:'OPEN',revision:1,notes:clean(p.notes),expectedDate:clean(p.expectedDate),createdAt:now,updatedAt:now,deviceId:'SERVERJJ'};
   next.purchaseOrders.unshift(order);message='บันทึกใบสั่งซื้อ '+order.orderNo+' แล้ว (ยังไม่เพิ่มสต๊อก)';
  }else{
   const order=next.purchaseOrders.find(o=>o.id===p.orderId);if(!order)throw Error('ไม่พบใบสั่งซื้อ');
   if(order.revision!==Number(p.expectedOrderRevision))throw Error('ใบสั่งซื้อเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด');
   if(!['OPEN','PARTIAL'].includes(order.status))throw Error('ใบสั่งซื้อนี้ปิดแล้ว');
   if(action==='order.cancel'){
    if(!clean(p.reason))throw Error('กรุณาระบุเหตุผลปิดยอดค้าง');order.status='CANCELLED';order.closeReason=clean(p.reason);message='ปิดยอดค้างใบสั่งซื้อแล้ว';
   }else{
    if(!Array.isArray(p.items)||!p.items.length)throw Error('ระบุสินค้าที่รับจริง');
    const seen=new Set();for(const i of p.items){if(seen.has(i.productId))throw Error('สินค้าซ้ำ');seen.add(i.productId);const line=order.items.find(l=>l.productId===i.productId);const quantity=num(i.quantity,'จำนวนรับ',true);if(!line||!quantity||quantity>line.quantity-line.received)throw Error('จำนวนรับเกินยอดค้างหรือไม่มีในใบสั่งซื้อ');}
    const receipt=Core.apply(next,{...command,payload:{...p,workflow:undefined,supplierId:order.supplierId}},now);if(receipt.result.status!=='applied')return receipt;
    const updated=receipt.state.purchaseOrders.find(o=>o.id===order.id);for(const i of p.items)updated.items.find(l=>l.productId===i.productId).received+=Number(i.quantity);
    updated.status=updated.items.every(l=>l.received===l.quantity)?'RECEIVED':'PARTIAL';updated.revision++;updated.updatedAt=now;
    const doc=receipt.state.purchases.find(r=>r.id==='web_purchase_'+command.id);doc.orderId=order.id;doc.orderNo=order.orderNo;doc.receivingType='ORDER';return receipt;
   }
   order.revision++;order.updatedAt=now;
  }
  const result={id:command.id,status:'applied',message,completedAt:now};next.meta||={};next.meta.inventoryBridge||={};next.meta.inventoryBridge.results||={};next.meta.inventoryBridge.results[command.id]=result;
  next.auditLogs||=[];next.auditLogs.push({id:'web_audit_'+command.id,action:action==='report.prepare'?'WEB_REPORT':'WEB_PURCHASING',createdAt:now,details:{action,message}});return {state:next,result};
 }catch(e){return {state,result:{id:command.id,status:'rejected',message:e.message,completedAt:now}};}
}
module.exports={apply};
