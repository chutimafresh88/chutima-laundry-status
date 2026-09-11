'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');

function run(exe,args,env){
  return new Promise((resolve,reject)=>{
    const child=spawn(exe,args,{env:{...process.env,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
    child.stdout.on('data',chunk=>{if(output.length<1048576)output+=chunk;});child.stderr.resume();
    child.once('error',reject);child.once('close',code=>code===0?resolve(output):reject(Error('ตรวจหรือสำรองฐานข้อมูลชุติมาไม่สำเร็จ')));
  });
}
class ServerBackup{
  constructor({pool,config,base}){this.pool=pool;this.config=config;this.base=base;this.running=null;this.error=null;}
  create(){if(this.running)return this.running;this.running=this.run().catch(e=>{this.error=e.message;throw e;}).finally(()=>{this.running=null;});return this.running;}
  async run(){
    const dir=path.resolve(this.base,this.config.backupDirectory),bin=path.resolve(this.base,this.config.postgresBin);
    if(!path.basename(dir).toLowerCase().includes('chutima'))throw Error('ต้องใช้โฟลเดอร์สำรองที่แยกสำหรับชุติมา');
    fs.mkdirSync(dir,{recursive:true});
    const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8);
    const temp=path.join(dir,'chutima-'+id+'.partial'),file=path.join(dir,'chutima-'+id+'.dump');
    const env={PGHOST:'127.0.0.1',PGPORT:'5433',PGDATABASE:'chutima',PGUSER:this.config.database.user,PGPASSWORD:this.config.database.password,PGCONNECT_TIMEOUT:'10'};
    await run(path.join(bin,'pg_dump.exe'),['--format=custom','--no-password','--file',temp,'chutima'],env);
    const list=await run(path.join(bin,'pg_restore.exe'),['--list',temp],env);
    for(const table of ['entities','operations','devices','allocations','changefeed'])if(!list.includes('TABLE DATA chutima '+table+' '))throw Error('ข้อมูลสำรองไม่ครบ');
    const hasher=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(temp))hasher.update(chunk);
    const manifest={id,createdAt:new Date().toISOString(),bytes:fs.statSync(temp).size,sha256:hasher.digest('hex'),archiveChecked:true,restored:false};
    fs.renameSync(temp,file);fs.writeFileSync(file+'.json',JSON.stringify(manifest,null,2),{flag:'wx'});
    this.error=null;this.last={...manifest,file};return this.last;
  }
  start(){this.create().catch(()=>{});this.timer=setInterval(()=>this.create().catch(()=>{}),3600000);this.timer.unref?.();}
  stop(){clearInterval(this.timer);}
}
module.exports={ServerBackup,run};
