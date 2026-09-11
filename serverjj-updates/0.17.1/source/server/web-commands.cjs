'use strict';
const Model=require('../central/model.cjs');
const Core=require('../renderer/inventory-bridge-core.js');
const Purchasing=require('./office-documents.cjs');
const uuid=value=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value||'');
async function stateFrom(db){
  const rows=(await db.query('SELECT collection,id,body FROM chutima.entities WHERE body IS NOT NULL ORDER BY revision')).rows;
  return Model.applyRecords({meta:{}},rows.map(r=>({collection:r.collection,key:r.id,value:r.body})));
}
class WebCommands{
  constructor(engine){this.engine=engine;}
  async apply(command){
    if(!uuid(command?.id)||!['product.save','stock.receive','stock.count','supplier.save','purchase.receive'].includes(command.type)||!command.payload||typeof command.payload!=='object'||Array.isArray(command.payload))throw Error('รายการจากเว็บไม่ถูกต้อง');
    const digest=Model.hash({id:command.id,type:command.type,payload:command.payload});
    return this.engine.transaction(async db=>{
      const old=(await db.query('SELECT digest,result FROM chutima.web_results WHERE id=$1',[command.id])).rows[0];
      if(old){if(old.digest!==digest)throw Error('เลขรายการเว็บซ้ำกับข้อมูลอื่น');return old.result;}
      const pending=(await db.query('SELECT digest,product_id FROM chutima.web_commands WHERE id=$1',[command.id])).rows[0];
      if(pending&&pending.digest!==digest)throw Error('เลขรายการเว็บซ้ำกับข้อมูลอื่น');
      const state=await stateFrom(db);
      const legacy=state.serverjjMigration?.legacyInventoryResults?.[command.id];
      // Legacy ACKs may have been lost after the receipt committed in SQLite.
      // Bind that durable receipt to its original cloud UUID before replaying.
      if(legacy&&['applied','rejected'].includes(legacy.status)){
        const receipt={...legacy,id:command.id};await db.query('INSERT INTO chutima.web_results(id,digest,result) VALUES($1,$2,$3)',[command.id,digest,JSON.stringify(receipt)]);return receipt;
      }
      const applied=command.type==='purchase.receive'?Purchasing.apply(state,command):Core.apply(state,command);
      let result=applied.result,next=applied.state;
      if(result.status==='applied'&&Object.values(next.settings.products).some(p=>p.trackStock===false)){
        result={id:command.id,status:'rejected',message:'สินค้าทุกตัวต้องเปิดตรวจสต๊อกเมื่อใช้ SERVERJJ',completedAt:new Date().toISOString()};next=state;
      }
      const primary=(await db.query('SELECT id FROM chutima.devices WHERE slot=1 AND enabled=true')).rows[0];
      if(!primary)throw Error('รอจับคู่ POS หลักก่อนรับรายการเว็บ');
      if(['receipt.edit','receipt.void'].includes(command.payload.workflow))return require('./document-transaction.cjs')({db,engine:this.engine,state,next,result,command,digest,primary});
      const productId=pending?.product_id||((command.type==='stock.count'||command.payload.workflow==='purchase.return')?command.payload.productId:null);
      const before=state.settings?.products?.[productId],after=next.settings?.products?.[productId];
      if(result.status==='applied'&&(command.type==='stock.count'||command.payload.workflow==='purchase.return')&&before&&after){
        await db.query('INSERT INTO chutima.web_commands(id,digest,command,product_id) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[command.id,digest,JSON.stringify(command),productId]);
        const allocated=Number((await db.query('SELECT coalesce(sum(available),0) AS n FROM chutima.allocations WHERE product_id=$1',[productId])).rows[0].n);
        // An offline device keeps its rights until it durably zeros its own
        // stock and sends an ordered operation. Timeouts never reclaim rights.
        if(allocated>0)return {id:command.id,status:'pending',message:'รอ POS ทุกเครื่องส่งยอดและพักขายสินค้านี้ก่อนยืนยันผลตรวจนับ'};
      }
      await db.query('INSERT INTO chutima.web_commands(id,digest,command,product_id) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[command.id,digest,JSON.stringify(command),pending?.product_id||null]);
      const changes=Model.changes(state,next);
      for(const change of changes){
        if(change.collection==='products'){
          const delta=Number(change.value?.stockOnHand||0)-Number(change.before?.stockOnHand||0);
          Model.assertCount(Number(change.value?.stockOnHand||0));
          if(delta>0)await db.query('INSERT INTO chutima.allocations(product_id,device_id,available) VALUES($1,$2,$3) ON CONFLICT(product_id,device_id) DO UPDATE SET available=chutima.allocations.available+excluded.available',[change.key,primary.id,delta]);
          if(delta<0&&!productId)throw Error('ต้องตรวจนับก่อนลดสต๊อก');
        }
        // Web purchases have a stable server owner, preventing a stale POS
        // copy from rewriting the supplier payment document.
        if(['purchases','purchaseOrders','supplierReturns'].includes(change.collection)&&change.value)change.value.deviceId='SERVERJJ';
        await this.engine.write(db,change,'web_'+command.id);
      }
      if(pending?.product_id||result.status==='applied'&&(command.type==='stock.count'||command.payload.workflow==='purchase.return')&&before&&after){
        const p=next.settings.products[productId];
        const current=Number((await db.query('SELECT coalesce(sum(available),0) AS n FROM chutima.allocations WHERE product_id=$1',[productId])).rows[0].n);
        let reserve=Model.assertCount(Number(p.stockOnHand)-current);
        const released=(await db.query('SELECT r.device_id,r.quantity FROM chutima.web_releases r JOIN chutima.devices d ON d.id=r.device_id WHERE command_id=$1 ORDER BY d.slot',[command.id])).rows;
        for(const r of released){const amount=Math.min(reserve,Number(r.quantity));reserve-=amount;await db.query('INSERT INTO chutima.allocations(product_id,device_id,available) VALUES($1,$2,$3) ON CONFLICT(product_id,device_id) DO UPDATE SET available=chutima.allocations.available+excluded.available',[productId,r.device_id,amount]);}
        if(reserve)await db.query('INSERT INTO chutima.allocations(product_id,device_id,available) VALUES($1,$2,$3) ON CONFLICT(product_id,device_id) DO UPDATE SET available=chutima.allocations.available+excluded.available',[productId,primary.id,reserve]);
        // Rejected stale counts still restore all surrendered quantities.
        await this.engine.write(db,{collection:'products',key:productId,value:p},'web_'+command.id);
      }
      await db.query('INSERT INTO chutima.web_results(id,digest,result) VALUES($1,$2,$3)',[command.id,digest,JSON.stringify(result)]);
      return result;
    });
  }
  async snapshot(){
    return this.engine.transaction(async db=>{
      const initialized=(await db.query('SELECT initialized FROM chutima.coordination WHERE id=1')).rows[0].initialized;
      if(!initialized)return null;
      const state=await stateFrom(db),snapshot=Core.snapshot(state);
      snapshot.revision=Number((await db.query('SELECT coalesce(max(sequence),0) AS n FROM chutima.changefeed')).rows[0].n);
      const allocations=(await db.query('SELECT a.product_id,a.device_id,a.available,d.label FROM chutima.allocations a JOIN chutima.devices d ON d.id=a.device_id')).rows;
      for(const p of snapshot.products)p.allocations=allocations.filter(a=>a.product_id===p.id).map(a=>({deviceId:a.device_id,label:a.label,available:Number(a.available)}));
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date()),Reports=require('./reports.cjs');
      const dashboard={date:today,cash:Reports.build(state,{kind:'overview',from:today,to:today}).rows[0]||{},queues:Object.fromEntries(['WAITING','WORKING','READY','COMPLETED'].map(status=>[status,(state.queues||[]).filter(q=>q.status===status&&(status!=='COMPLETED'||String(q.completedAt||'').startsWith(today))).length]))};
      const records=[];
      for(const collection of ['products','suppliers','purchases','movements'])for(const row of snapshot[collection])records.push({collection,id:row.id,body:row});
      for(const collection of ['purchaseOrders','supplierReturns'])for(const row of state[collection]||[])records.push({collection,id:row.id,body:row});
      for(const page of state.reportPages||[])records.push({collection:'reportPages',id:page.requestId,body:page});
      records.push({collection:'meta',id:'catalog',body:{officeSettings:state.officeSettings,dashboard,categories:snapshot.categories,purchaseWorkflowVersion:2,reportVersion:1}});
      return {revision:snapshot.revision,records,manifest:Object.fromEntries(['products','suppliers','purchases','movements','meta','purchaseOrders','supplierReturns','reportPages'].map(c=>[c,records.filter(r=>r.collection===c).length]))};
    });
  }
}
module.exports={WebCommands,stateFrom};
