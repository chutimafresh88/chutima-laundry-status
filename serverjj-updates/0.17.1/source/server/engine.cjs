'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Model = require('../central/model.cjs');

function mergeValue(current, before, after, field='ข้อมูล') {
  if (Model.canonical(before) === Model.canonical(after)) return structuredClone(current);
  if (Model.canonical(current) === Model.canonical(before) || Model.canonical(current) === Model.canonical(after)) return structuredClone(after);
  if (current && before && after && !Array.isArray(current) && !Array.isArray(before) && !Array.isArray(after) && typeof current === 'object' && typeof before === 'object' && typeof after === 'object') {
    const result = structuredClone(current);
    for (const key of new Set([...Object.keys(before),...Object.keys(after)])) {
      if (Model.canonical(before[key]) === Model.canonical(after[key])) continue;
      if (['updatedAt'].includes(key)) { result[key] = after[key]; continue; }
      const value = mergeValue(current[key],before[key],after[key],`${field}.${key}`);
      if (value === undefined) delete result[key]; else result[key] = value;
    }
    return result;
  }
  const error = Error(`ข้อมูลเปลี่ยนจากอีกช่องทาง: ${field} กรุณาตรวจรายการก่อนซิงค์ต่อ`);
  error.code='CONFLICT'; throw error;
}

class Engine {
  constructor(pool) { this.pool=pool; }
  async connection() { return typeof this.pool.connect === 'function' ? this.pool.connect() : this.pool; }
  async transaction(fn) {
    const client=await this.connection();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM chutima.coordination WHERE id=1 FOR UPDATE');
      const result=await fn(client);
      await client.query('COMMIT');return result;
    } catch(error) { await client.query('ROLLBACK');throw error; }
    finally { client.release?.(); }
  }
  async init() {
    const client=await this.connection();
    try {
      const sql=fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8');
      if(typeof client.exec==='function')await client.exec(sql);else await client.query(sql);
    }
    finally { client.release?.(); }
  }
  async register({id,label,keyHash}) {
    if(!Model.id(id)||!label||!keyHash)throw Error('ข้อมูลลงทะเบียนเครื่องไม่ครบ');
    return this.transaction(async db=>{
      const existing=(await db.query('SELECT id,label,slot FROM chutima.devices WHERE id=$1',[id])).rows[0];
      if(existing)return existing;
      const devices=(await db.query('SELECT slot FROM chutima.devices ORDER BY slot')).rows;
      if(devices.length>=2)throw Error('ร้านนี้รองรับ POS ไม่เกิน 2 เครื่อง');
      const slot=devices.some(d=>d.slot===1)?2:1;
      return (await db.query('INSERT INTO chutima.devices(id,label,slot,key_hash) VALUES($1,$2,$3,$4) RETURNING id,label,slot',[id,label.slice(0,80),slot,keyHash])).rows[0];
    });
  }
  async device(id) { return (await this.pool.query('SELECT * FROM chutima.devices WHERE id=$1 AND enabled=true',[id])).rows[0]; }
  async write(db,record,operationId,owner=null) {
    const {collection,key,value}=record;
    Model.entityKey(collection,key);
    const revision=Number((await db.query('INSERT INTO chutima.changefeed(collection,id,body,operation_id) VALUES($1,$2,$3,$4) RETURNING sequence',[collection,key,JSON.stringify(value),operationId])).rows[0].sequence);
    await db.query('INSERT INTO chutima.entities(collection,id,body,owner_device,revision) VALUES($1,$2,$3,$4,$5) ON CONFLICT(collection,id) DO UPDATE SET body=excluded.body,revision=excluded.revision,owner_device=coalesce(chutima.entities.owner_device,excluded.owner_device)',[collection,key,JSON.stringify(value),owner,revision]);
    return revision;
  }
  async apply(operation) {
    const {sequence,digest,...payload}=operation;
    if(payload.protocol!==1||!Model.id(payload.deviceId)||!Model.id(payload.operationId)||!Number.isSafeInteger(sequence)||sequence<1||!Array.isArray(payload.changes)||payload.changes.length>50000||Model.hash(payload)!==digest)throw Error('รูปแบบรายการซิงค์ไม่ถูกต้อง');
    return this.transaction(async db=>{
      const device=(await db.query('SELECT * FROM chutima.devices WHERE id=$1 AND enabled=true',[payload.deviceId])).rows[0];
      if(!device)throw Error('เครื่องนี้ยังไม่ได้รับสิทธิ์');
      const duplicate=(await db.query('SELECT digest,result FROM chutima.operations WHERE id=$1',[payload.operationId])).rows[0];
      if(duplicate){if(duplicate.digest!==digest)throw Error('รหัสรายการเดิมมีข้อมูลไม่ตรงกัน');return duplicate.result;}
      if(sequence!==Number(device.last_sequence)+1)throw Error('ลำดับรายการไม่ต่อเนื่อง กรุณาส่งรายการค้างก่อน');
      const initialized=(await db.query('SELECT initialized FROM chutima.coordination WHERE id=1')).rows[0].initialized;
      if(payload.bootstrap && (initialized || device.slot!==1))throw Error('ไม่สามารถนำข้อมูลตั้งต้นทับร้านที่ใช้งานแล้ว');
      if(!payload.bootstrap&&!initialized)throw Error('กรุณานำเข้าข้อมูลตั้งต้นก่อน');
      const transfers=payload.transfers||[];
      const releases=payload.releases||[];
      if(!Array.isArray(releases)||releases.length>100||payload.bootstrap&&releases.length)throw Error('รายการพักสต๊อกไม่ถูกต้อง');
      const releaseTotals={};
      for(const r of releases){
        if(!Model.id(r.commandId)||!Model.id(r.productId)||!Number.isSafeInteger(r.quantity)||r.quantity<1||releaseTotals[r.productId])throw Error('รายการพักสต๊อกไม่ถูกต้อง');
        const command=(await db.query('SELECT id FROM chutima.web_commands WHERE id=$1 AND product_id=$2',[r.commandId,r.productId])).rows[0];
        if(!command)throw Error('ไม่พบรายการตรวจนับที่รออยู่');
        releaseTotals[r.productId]=r.quantity;
      }
      if(!Array.isArray(transfers)||transfers.length>100||payload.bootstrap&&transfers.length)throw Error('รายการโอนจำนวนไม่ถูกต้อง');
      const transferTotals={};
      for(const t of transfers){
        if(!Model.id(t.productId)||!Model.id(t.toDevice)||t.toDevice===device.id||!Number.isSafeInteger(t.quantity)||t.quantity<1)throw Error('ข้อมูลโอนจำนวนไม่ถูกต้อง');
        if(!(await db.query('SELECT id FROM chutima.devices WHERE id=$1 AND enabled=true',[t.toDevice])).rows.length)throw Error('ไม่พบเครื่องปลายทาง');
        transferTotals[t.productId]=(transferTotals[t.productId]||0)+t.quantity;
      }
      let cursor=0;
      const seen=new Set();
      for(const change of payload.changes){
        const {collection,key,before,value}=change,k=Model.entityKey(collection,key);
        if(collection==='reportPages'||collection==='app'&&['reportPage','officeSettings','officeCapabilities'].includes(key))throw Error('รายงานแก้ไขจาก POS ไม่ได้');
        if(seen.has(k))throw Error('มีรายการข้อมูลซ้ำในธุรกรรม');seen.add(k);
        const row=(await db.query('SELECT * FROM chutima.entities WHERE collection=$1 AND id=$2',[collection,key])).rows[0];
        if(Model.OWNED.has(collection) && row?.owner_device && row.owner_device!==device.id)throw Error('รายการนี้เป็นของ POS อีกเครื่อง');
        if(Model.OWNED.has(collection)&&row?.body?.deviceId==='SERVERJJ')throw Error('รายการนี้บันทึกจากเว็บ กรุณาจัดการที่เว็บหลังบ้าน');
        if(['settings','promotions','employees','suppliers'].includes(collection)&&device.slot!==1)throw Error('แก้ข้อมูลร้านที่ POS หลักหรือเว็บหลังบ้าน');
        let merged;
        if(collection==='products'){
          const a=structuredClone(before),b=structuredClone(value),c=structuredClone(row?.body??null);
          for(const field of ['packBarcode','packSize'])if(b&&c&&!(field in b)){b[field]=c[field];if(a)a[field]=c[field];}
          if(b) {if(b.id!==key)throw Error('รหัสสินค้าไม่ตรงกัน');Model.assertCount(Number(b.stockOnHand));}
          if(c && c.trackStock!==false && b?.trackStock===false)throw Error('ห้ามปิดตรวจสต๊อกเพื่อขายเกิน');
          // stockOnHand is local allocated stock in POS; the central product
          // retains the shop total. Compare catalog fields separately.
          for(const v of [a,b,c])if(v)delete v.stockOnHand;
          if(device.slot!==1){
            const fields=v=>{const copy=structuredClone(v);if(copy)delete copy.updatedAt;return copy;};
            if(Model.canonical(fields(a))!==Model.canonical(fields(b)))throw Error('แก้ข้อมูลสินค้าที่ POS หลักหรือเว็บหลังบ้าน');
          }
          merged=payload.bootstrap?structuredClone(value):mergeValue(c,a,b,k);
          const quota=Number((await db.query('SELECT available FROM chutima.allocations WHERE product_id=$1 AND device_id=$2',[key,device.id])).rows[0]?.available||0);
          const delta=payload.bootstrap?Number(value?.stockOnHand||0):Number(payload.stockDeltas?.[key]||0);
          if(!Number.isSafeInteger(delta))throw Error('จำนวนเปลี่ยนสต๊อกไม่ถูกต้อง');
          if(!payload.bootstrap && delta!==Number(value?.stockOnHand||0)-Number(before?.stockOnHand||0))throw Error('ผลสต๊อกไม่ตรงกับเอกสาร');
          const available=Model.assertCount(quota+delta,'จำนวนที่เครื่องขายได้');
          const total=Model.assertCount(Number(row?.body?.stockOnHand||0)+delta+(transferTotals[key]||0)+(releaseTotals[key]||0),'สต๊อกรวม');
          if(merged===null && total!==0)throw Error('ยังมีสต๊อกคงเหลือ ไม่สามารถลบสินค้า');
          if(merged)merged.stockOnHand=total;
          await db.query('INSERT INTO chutima.allocations VALUES($1,$2,$3) ON CONFLICT(product_id,device_id) DO UPDATE SET available=excluded.available',[key,device.id,available]);
        } else {
          merged=payload.bootstrap?structuredClone(value):mergeValue(row?.body??null,before,value,k);
        }
        if(Model.APPEND_ONLY.has(collection)&&row&&Model.canonical(row.body)!==Model.canonical(merged))throw Error('ไม่สามารถแก้ประวัติที่บันทึกแล้ว');
        if(Model.OWNED.has(collection)&&merged)merged.deviceId=row?.owner_device||device.id;
        cursor=await this.write(db,{collection,key,value:merged},payload.operationId,Model.OWNED.has(collection)?device.id:null);
      }
      for(const [productId,delta] of Object.entries(payload.stockDeltas||{}))if(delta&&!seen.has('products/'+productId))throw Error('ไม่มีรายการสินค้าประกอบการเปลี่ยนสต๊อก');
      for(const r of releases){
        if(!seen.has('products/'+r.productId)||transferTotals[r.productId]||Number(payload.stockDeltas?.[r.productId]||0)!==-r.quantity)throw Error('ต้องพักจำนวนขายในเครื่องก่อนตรวจนับ');
        await db.query('INSERT INTO chutima.web_releases(command_id,device_id,product_id,quantity) VALUES($1,$2,$3,$4) ON CONFLICT(command_id,device_id,product_id) DO UPDATE SET quantity=chutima.web_releases.quantity+excluded.quantity',[r.commandId,device.id,r.productId,r.quantity]);
        // A response can become stale while the POS is applying it. Complete
        // its durable release, then return those rights to the same device.
        if((await db.query('SELECT id FROM chutima.web_results WHERE id=$1',[r.commandId])).rows.length)await db.query('UPDATE chutima.allocations SET available=available+$1 WHERE product_id=$2 AND device_id=$3',[r.quantity,r.productId,device.id]);
      }
      for(let index=0;index<transfers.length;index++){
        const t=transfers[index];
        if(!seen.has('products/'+t.productId)||Number(payload.stockDeltas?.[t.productId]||0)>-transferTotals[t.productId])throw Error('ต้องลดจำนวนที่เครื่องต้นทางก่อนโอน');
        const current=Number((await db.query('SELECT available FROM chutima.allocations WHERE product_id=$1 AND device_id=$2',[t.productId,t.toDevice])).rows[0]?.available||0);
        await db.query('INSERT INTO chutima.allocations VALUES($1,$2,$3) ON CONFLICT(product_id,device_id) DO UPDATE SET available=excluded.available',[t.productId,t.toDevice,Model.assertCount(current+t.quantity)]);
        await db.query('INSERT INTO chutima.stock_transfers(id,product_id,from_device,to_device,quantity) VALUES($1,$2,$3,$4,$5)',[payload.operationId+'_'+index,t.productId,device.id,t.toDevice,t.quantity]);
      }
      if(payload.bootstrap)await db.query('UPDATE chutima.coordination SET initialized=true WHERE id=1');
      const result={applied:true,operationId:payload.operationId,digest,cursor};
      await db.query('INSERT INTO chutima.operations(id,device_id,device_sequence,digest,payload,result) VALUES($1,$2,$3,$4,$5,$6)',[payload.operationId,device.id,sequence,digest,JSON.stringify(payload),JSON.stringify(result)]);
      await db.query('UPDATE chutima.devices SET last_sequence=$1,last_seen=now() WHERE id=$2',[sequence,device.id]);
      return result;
    });
  }
  async pull(deviceId,after=0,limit=500) {
    if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw Error('ช่วงข้อมูลไม่ถูกต้อง');
    return this.transaction(async db=>{
    const rows=(await db.query('SELECT c.sequence,c.collection,c.id,e.body FROM chutima.changefeed c JOIN chutima.entities e ON e.collection=c.collection AND e.id=c.id WHERE c.sequence>$1 ORDER BY c.sequence LIMIT $2',[after,limit])).rows;
    const quota=new Map((await db.query('SELECT product_id,available FROM chutima.allocations WHERE device_id=$1',[deviceId])).rows.map(r=>[r.product_id,Number(r.available)]));
    const records=rows.map(row=>{
      const value=structuredClone(row.body);
      if(row.collection==='products'&&value){value.stockOnHand=quota.get(row.id)||0;}
      return {collection:row.collection,key:row.id,value,revision:Number(row.sequence)};
    });
    return {records,cursor:rows.length?Number(rows.at(-1).sequence):after,hasMore:rows.length===limit};
    });
  }
  async exportState() {
    const rows=(await this.pool.query('SELECT collection,id,body FROM chutima.entities WHERE body IS NOT NULL ORDER BY revision')).rows;
    return Model.applyRecords({meta:{}},rows.map(r=>({collection:r.collection,key:r.id,value:r.body})));
  }
}
module.exports={Engine,mergeValue};
