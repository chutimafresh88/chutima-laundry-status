'use strict';
const crypto=require('node:crypto');
const {WebCommands}=require('./web-commands.cjs');
const CLOUD_URL='https://dgvdwdmaxvtfnjiiixcm.supabase.co';
const PUBLIC_KEY='sb_publishable_36A6PC0czqhUSzvnI0HgfQ_FIPc4YUK';
class CloudRelay{
 constructor({engine,fetchImpl=fetch}){this.engine=engine;this.web=new WebCommands(engine);this.fetch=fetchImpl;this.config=null;this.running=null;this.registering=null;this.last={configured:false,active:false,lastSyncAt:null,error:null};}
 async init(){
  await this.engine.transaction(async db=>{
   let row=(await db.query('SELECT body FROM chutima.cloud_config WHERE id=1')).rows[0];
   if(!row){const body={serverId:crypto.randomUUID(),key:crypto.randomBytes(32).toString('base64url'),registered:false};await db.query('INSERT INTO chutima.cloud_config(id,body) VALUES(1,$1)',[JSON.stringify(body)]);row={body};}
   this.config=row.body;
  });this.last.configured=this.config.registered===true;
 }
 status(){return {...this.last};}
 async request(action,body={},ownerToken){
  const response=await this.fetch(CLOUD_URL+'/functions/v1/serverjj-relay',{method:'POST',headers:{apikey:PUBLIC_KEY,'Content-Type':'application/json',...(ownerToken?{Authorization:'Bearer '+ownerToken}:{'X-Chutima-Key':this.config.key})},body:JSON.stringify({serverId:this.config.serverId,action,...body}),signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!response.ok){const e=Error(response.status===401||response.status===403?'กรุณาเข้าสู่ระบบเจ้าของร้านเพื่อเชื่อมเว็บ':'เชื่อมเว็บยังไม่สำเร็จ ระบบจะลองใหม่อัตโนมัติ');e.status=response.status;throw e;}
  return response.json();
 }
 register(ownerToken){
  if(this.config.registered)return Promise.resolve(this.status());
  if(this.registering)return this.registering;
  if(typeof ownerToken!=='string'||ownerToken.length<50||ownerToken.length>16384)return Promise.reject(Error('กรุณาเข้าสู่ระบบเว็บหลังบ้านที่ POS หลัก'));
  this.registering=(async()=>{
   const result=await this.request('register',{keyHash:crypto.createHash('sha256').update(this.config.key).digest('hex')},ownerToken);
   if(result.registered!==true||result.serverId!==this.config.serverId)throw Error('ผลลงทะเบียนไม่ตรงกับ SERVERJJ');
   const next={...this.config,registered:true,shopId:result.shopId};await this.engine.pool.query('UPDATE chutima.cloud_config SET body=$1 WHERE id=1',[JSON.stringify(next)]);this.config=next;
   this.last.configured=true;this.last.error=null;this.tick();return this.status();
  })().finally(()=>{this.registering=null;});return this.registering;
 }
 async publish(snapshot,remote){
  if(snapshot.revision<Number(remote.revision))throw Error('ข้อมูล SERVERJJ เก่ากว่าเว็บ ต้องตรวจข้อมูลกู้คืนก่อนซิงค์ต่อ');
  if(remote.active&&snapshot.revision===Number(remote.revision))return;
  const generation=crypto.randomUUID();let page=[],bytes=0;
  const flush=async()=>{if(page.length)await this.request('stage',{generation,records:page});page=[];bytes=0;};
  for(const record of snapshot.records){const size=Buffer.byteLength(JSON.stringify(record));if(size>262144)throw Error('รายการสินค้าใหญ่เกินกำหนด กรุณาตรวจรูปสินค้า');if(page.length>=200||bytes+size>800000)await flush();page.push(record);bytes+=size;}
  await flush();await this.request('publish',{generation,revision:snapshot.revision,manifest:snapshot.manifest});
 }
 tick(){
  if(this.running)return this.running;if(!this.config?.registered)return Promise.resolve(this.status());
  this.running=(async()=>{try{
   const rows=(await this.engine.pool.query('SELECT id,label,last_seen,reported_pending FROM chutima.devices WHERE enabled=true ORDER BY slot')).rows;
   const devices=rows.map(d=>({id:d.id,label:d.label,pending:Number(d.reported_pending),online:!!d.last_seen&&Date.now()-new Date(d.last_seen).getTime()<30000}));
   const remote=await this.request('exchange',{devices}),results=[];
   if(!Number.isSafeInteger(remote.revision)||remote.revision<0||!Array.isArray(remote.commands)||remote.commands.length>50)throw Error('ข้อมูลตอบกลับจากเว็บไม่ถูกต้อง');
   const before=await this.web.snapshot();
   if(!before){this.last.error='รอ POS หลักนำข้อมูลร้านเข้า SERVERJJ';return this.status();}
   if(before.revision<remote.revision)throw Error('ข้อมูล SERVERJJ เก่ากว่าเว็บ ต้องตรวจข้อมูลกู้คืนก่อนซิงค์ต่อ');
   for(const command of remote.commands||[]){const result=await this.web.apply(command);if(result.status==='pending'){await this.request('progress',{id:result.id,message:result.message});break;}results.push(result);if(command.payload?.workflow==='report.prepare')break;}
   const snapshot=await this.web.snapshot();if(!snapshot){this.last.error='รอ POS หลักนำข้อมูลร้านเข้า SERVERJJ';return this.status();}
   await this.publish(snapshot,remote);
   for(const r of results)await this.request('result',{id:r.id,status:r.status,message:r.message});
   this.last={configured:true,active:true,lastSyncAt:new Date().toISOString(),error:null};
  }catch(error){this.last.error=/[ก-๙]/.test(error.message)?error.message:'ติดต่อเว็บไม่ได้ SERVERJJ และ POS ยังทำงานในร้านได้';}
  return this.status();})().finally(()=>{this.running=null;});return this.running;
 }
 start(){this.timer=setInterval(()=>this.tick(),10000);this.timer.unref?.();this.tick();}
 stop(){clearInterval(this.timer);}
}
module.exports={CloudRelay};
