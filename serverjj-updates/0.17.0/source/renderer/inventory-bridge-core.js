(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./pos-core.js') : root.POS);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InventoryBridge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(POS) {
  'use strict';
  const fields = ['id','name','sku','barcode','packBarcode','packSize','category','unit','price','costPrice','stockOnHand','lowStockAt','enabled','trackStock','image','createdAt','updatedAt'];
  const clean = (value, limit=240) => String(value ?? '').trim().slice(0,limit);
  const own = (obj,key) => Object.prototype.hasOwnProperty.call(obj || {},key);
  const safeId = value => /^[A-Za-z0-9_-]{1,100}$/.test(String(value));
  function version(product) {
    if (!product) return null;
    return JSON.stringify(fields.filter(k=>k!=='image').map(k=>product[k] ?? null));
  }
  function stockVersion(state, product) {
    return JSON.stringify([Number(product.stockOnHand||0), (state.inventoryMovements||[]).find(m=>m.productId===product.id)?.id || null, product.trackStock!==false]);
  }
  function snapshot(state) {
    return {
      schema:1, revision:Number(state.meta?.inventoryBridge?.revision||0),
      products:Object.values(state.settings?.products||{}).map(p=>({...Object.fromEntries(fields.map(k=>[k,p[k]??null])),version:version(p),stockVersion:stockVersion(state,p)})),
      categories:[...(state.settings?.productCategories||[])],
      suppliers:structuredClone(state.suppliers||[]), purchases:structuredClone(state.purchases||[]),
      movements:(state.inventoryMovements||[]).slice(0,2000).map(m=>({id:m.id,productId:m.productId,delta:m.delta,type:m.type,qtyBefore:m.qtyBefore,qtyAfter:m.qtyAfter,unitCost:m.unitCost,note:m.note,documentNo:m.documentNo,createdAt:m.createdAt,actor:m.actor||'POS',sourceId:m.sourceId})),
    };
  }
  function changed(previous,next) {
    const a=snapshot(previous),b=snapshot(next);a.revision=0;b.revision=0;
    return JSON.stringify(a)!==JSON.stringify(b);
  }
  function number(value,label,integer=false,positive=false) {
    if (value === '' || value === null || value === undefined || !POS.nonnegative(value) || (integer && !POS.count(value)) || (positive && Number(value)<=0)) throw Error(`${label}ไม่ถูกต้อง`);
    return Number(value);
  }
  function apply(state, command, now=new Date().toISOString()) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(command?.id||'')) throw Error('เลขรายการไม่ถูกต้อง');
    const existing=state.meta?.inventoryBridge?.results?.[command.id];
    if(existing) return {state,result:existing,duplicate:true};
    const next=structuredClone(state),input=command.payload||{},id=command.id,actor=clean(command.actor||'เจ้าของร้านผ่านเว็บ',120);
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date(now));
    let movementIndex=0;
    next.settings ||= {}; next.settings.products ||= {}; next.inventoryMovements ||= [];next.suppliers ||= [];next.purchases ||= [];
    const getProduct=productId=>{if(!safeId(productId)||!own(next.settings.products,productId))throw Error('ไม่พบสินค้า');return next.settings.products[productId];};
    const assertVersion=(actual,expected)=>{if(expected!==actual)throw Error('ข้อมูลเปลี่ยนหลังจากเปิดฟอร์ม กรุณาอัปเดตข้อมูลแล้วตรวจอีกครั้ง');};
    const movement=(p,delta,type,note,documentNo='')=>next.inventoryMovements.unshift({id:`web_stock_${id}_${movementIndex++}`,productId:p.id,delta,type,sourceType:'WEB_BACKOFFICE',sourceId:id,qtyBefore:p.stockOnHand-delta,qtyAfter:p.stockOnHand,unitCost:p.costPrice,note:clean(note),documentNo:clean(documentNo,80),businessDate:date,createdAt:now,actor,shiftId:null,employeeId:null,dedupeKey:`web:${id}:${p.id}:${type}`});
    let message='บันทึกแล้ว';
    try {
      if(command.type==='product.save') {
        const productId=input.id || `web_product_${id}`;
        if(!safeId(productId)||['__proto__','constructor','prototype'].includes(productId))throw Error('รหัสสินค้าไม่ถูกต้อง');
        const original=own(next.settings.products,productId)?next.settings.products[productId]:null;
        assertVersion(version(original),input.expectedVersion??null);
        const p={...(original||{}),id:productId,name:clean(input.name,120),sku:clean(input.sku,80).toUpperCase(),barcode:clean(input.barcode,100),category:clean(input.category,80)||'ทั่วไป',unit:clean(input.unit,40),price:number(input.price,'ราคา'),costPrice:original?original.costPrice:number(input.costPrice,'ต้นทุน'),stockOnHand:original?original.stockOnHand:number(input.stockOnHand,'ยอดตั้งต้น',true),lowStockAt:number(input.lowStockAt,'ยอดเตือน',true),enabled:input.enabled!==false,trackStock:original?original.trackStock:input.trackStock!==false,createdAt:original?.createdAt||now,updatedAt:now,image:original?.image||''};
        if(own(input,'image')){if(input.image && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(input.image)||input.image.length>200000))throw Error('รูปสินค้าไม่ถูกต้องหรือมีขนาดใหญ่เกินไป');p.image=input.image;}
        p.packBarcode=own(input,'packBarcode')?clean(input.packBarcode,100):(original?.packBarcode||'');
        p.packSize=own(input,'packSize')?number(input.packSize,'ชิ้นต่อแพ็ก',true,true):(original?.packSize||1);
        if(p.packBarcode&&p.packBarcode===p.barcode)throw Error('บาร์โค้ดชิ้นและแพ็กต้องต่างกัน');
        const codes=[p.barcode,p.packBarcode].filter(Boolean);
        if(Object.values(next.settings.products).some(other=>other.id!==p.id&&[other.barcode,other.packBarcode].some(c=>c&&codes.includes(c))))throw Error('บาร์โค้ดนี้ใช้กับสินค้าอื่นแล้ว');
        POS.validateProduct(next,p);next.settings.products[productId]=p;
        if(!original&&p.trackStock!==false&&p.stockOnHand>0)movement(p,p.stockOnHand,'OPENING','ยอดตั้งต้นจากเว็บ');
        next.settings.productCategories=[...new Set([...(next.settings.productCategories||[]),p.category])];
        message=`บันทึก ${p.name} แล้ว`;
      } else if(command.type==='stock.receive'||command.type==='stock.count') {
        const p=getProduct(input.productId);if(p.trackStock===false)throw Error('สินค้านี้ไม่ได้ติดตามสต๊อก');
        const note=clean(input.note);if(!note)throw Error('กรุณาระบุเหตุผล');
        const before=number(p.stockOnHand,'สต๊อกปัจจุบัน',true),value=number(input.quantity,'จำนวน',true,command.type==='stock.receive');
        if(command.type==='stock.count')assertVersion(stockVersion(next,p),input.expectedStockVersion);
        if(command.type==='stock.receive'){
          const cost=number(input.unitCost,'ต้นทุน');
          p.costPrice=(before*Number(p.costPrice||0)+value*cost)/(before+value);p.stockOnHand=before+value;
        }else p.stockOnHand=value;
        if(!POS.count(p.stockOnHand))throw Error('จำนวนสต๊อกสูงเกินขอบเขต');
        p.updatedAt=now;movement(p,p.stockOnHand-before,command.type==='stock.receive'?'RECEIVE':'ADJUST',note,input.documentNo);
        message=`${p.name}: ${before} → ${p.stockOnHand} ${p.unit}`;
      } else if(command.type==='supplier.save') {
        const supplierId=input.id||`web_supplier_${id}`;if(!safeId(supplierId))throw Error('รหัสผู้จำหน่ายไม่ถูกต้อง');
        const original=next.suppliers.find(s=>s.id===supplierId);
        assertVersion(original?.updatedAt||null,input.expectedVersion??null);
        const supplier={...(original||{}),id:supplierId,code:clean(input.code,40).toUpperCase(),name:clean(input.name,120),contactName:clean(input.contactName,100),phone:clean(input.phone,40),lineId:clean(input.lineId,100),address:clean(input.address,400),notes:clean(input.notes),taxId:clean(input.taxId,30),creditDays:number(input.creditDays??0,'เครดิต',true),active:input.active!==false,createdAt:original?.createdAt||now,updatedAt:now};
        if(!supplier.code||!supplier.name)throw Error('กรุณากรอกรหัสและชื่อผู้จำหน่าย');
        if(next.suppliers.some(s=>s.id!==supplierId&&POS.key(s.code)===POS.key(supplier.code)))throw Error('รหัสผู้จำหน่ายซ้ำ');
        next.suppliers=next.suppliers.filter(s=>s.id!==supplierId);next.suppliers.push(supplier);message=`บันทึกผู้จำหน่าย ${supplier.name} แล้ว`;
      } else if(command.type==='purchase.receive') {
        const supplier=next.suppliers.find(s=>s.id===input.supplierId&&s.active!==false);if(!supplier)throw Error('ไม่พบผู้จำหน่ายที่เปิดใช้งาน');
        if(!Array.isArray(input.items)||!input.items.length||input.items.length>100)throw Error('กรุณาเลือกรายการจัดซื้อ');
        if(new Set(input.items.map(i=>i.productId)).size!==input.items.length)throw Error('สินค้าจัดซื้อซ้ำ');
        const items=input.items.map(i=>({product:getProduct(i.productId),quantity:number(i.quantity,'จำนวนรับเข้า',true,true),unitCost:number(i.unitCost,'ต้นทุน')}));
        const subtotal=POS.money(items.reduce((sum,i)=>sum+i.quantity*i.unitCost,0)),discount=number(input.discount??0,'ส่วนลด'),shipping=number(input.shipping??0,'ค่าขนส่ง');
        if(discount>subtotal)throw Error('ส่วนลดเกินยอดสินค้า');
        const total=POS.money(subtotal-discount+shipping),paidAmount=number(input.paidAmount??0,'ยอดจ่าย');
        if(!POS.nonnegative(total)||paidAmount>total)throw Error('ยอดชำระไม่ถูกต้อง');
        const method=['cash','qr','credit'].includes(input.paymentMethod)?input.paymentMethod:'credit';
        if(method==='credit'&&paidAmount>0)throw Error('เลือกช่องทางที่จ่ายจริง หรือระบุยอดจ่ายเป็น 0');
        const purchaseId=`web_purchase_${id}`,purchaseNo=`PO-W-${date.replaceAll('-','')}-${id.slice(0,8).toUpperCase()}`;
        const purchaseItems=items.map(i=>{
          const p=i.product,before=Number(p.stockOnHand||0),oldCost=Number(p.costPrice||0),lineTotal=POS.money(i.quantity*i.unitCost),share=subtotal>0?lineTotal/subtotal:1/items.length,effectiveLineTotal=lineTotal+(shipping-discount)*share,effectiveUnitCost=effectiveLineTotal/i.quantity;
          p.stockOnHand=p.trackStock===false?before:before+i.quantity;if(!POS.count(p.stockOnHand))throw Error('จำนวนสต๊อกสูงเกินขอบเขต');
          p.costPrice=p.trackStock===false?effectiveUnitCost:(before*oldCost+i.quantity*effectiveUnitCost)/(before+i.quantity);p.updatedAt=now;
          if(p.trackStock!==false)movement(p,i.quantity,'PURCHASE_RECEIVE',`${purchaseNo} · ${supplier.name}`,input.documentNo);
          return {productId:p.id,sku:p.sku,name:p.name,unit:p.unit,purchaseMode:'piece',quantity:i.quantity,unitCost:i.unitCost,lineTotal,effectiveUnitCost,effectiveLineTotal,stockBefore:before,stockAfter:p.stockOnHand,previousAverageCost:oldCost,newAverageCost:p.costPrice};
        });
        next.purchases.unshift({id:purchaseId,purchaseNo,businessDate:date,supplierId:supplier.id,supplierSnapshot:{code:supplier.code,name:supplier.name,contactName:supplier.contactName,phone:supplier.phone},documentNo:clean(input.documentNo,80),items:purchaseItems,subtotal,discount,shipping,total,paymentMethod:method,paidAmount,balance:POS.money(total-paidAmount),paymentStatus:paidAmount===total?'PAID':paidAmount>0?'PARTIAL':'UNPAID',payments:paidAmount?[{id:`web_payment_${id}`,method,amount:paidAmount,paidAt:now,createdAt:now,note:'ชำระจากเว็บหลังบ้าน (นอกลิ้นชัก POS)',shiftId:null,employeeId:null}]:[],dueDate:clean(input.dueDate,10)||null,notes:clean(input.notes),createdAt:now,updatedAt:now,shiftId:null,employeeId:null,actor});
        message=`บันทึก ${purchaseNo} และรับสินค้าแล้ว`;
      } else throw Error('ไม่รองรับประเภทรายการนี้');
      const result={id,status:'applied',message,completedAt:now};
      next.meta ||= {};next.meta.inventoryBridge ||= {revision:0,results:{}};next.meta.inventoryBridge.results ||= {};next.meta.inventoryBridge.results[id]=result;
      next.auditLogs ||= [];next.auditLogs.push({id:`web_audit_${id}`,action:'WEB_INVENTORY',createdAt:now,details:{type:command.type,actor,message}});
      return {state:next,result,duplicate:false};
    } catch(error) {
      const rejected=structuredClone(state);rejected.meta ||= {};rejected.meta.inventoryBridge ||= {revision:0,results:{}};rejected.meta.inventoryBridge.results ||= {};
      const result={id,status:'rejected',message:clean(error.message),completedAt:now};rejected.meta.inventoryBridge.results[id]=result;
      return {state:rejected,result,duplicate:false};
    }
  }
  return {snapshot,changed,apply,version,stockVersion};
});
