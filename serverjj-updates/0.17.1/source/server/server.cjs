'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {Pool}=require('pg');
const {Engine}=require('./engine.cjs');
const {createApi}=require('./http.cjs');
const {ServerBackup}=require('./backup.cjs');
const {CloudRelay}=require('./cloud-relay.cjs');

async function start(configFile){
  const file=path.resolve(configFile),config=JSON.parse(fs.readFileSync(file,'utf8'));
  // Fail closed rather than ever falling back to a shared PostgreSQL service.
  if(config.database?.host!=='127.0.0.1'||config.database.port!==5433||config.database.database!=='chutima'||!['chutima_owner','chutima_app'].includes(config.database.user))throw Error('ต้องใช้ฐานข้อมูลชุติมาที่แยกไว้บน 127.0.0.1:5433 เท่านั้น');
  if(config.port!==8443)throw Error('พอร์ตบริการชุติมาต้องเป็น 8443');
  const pool=new Pool({...config.database,max:4,connectionTimeoutMillis:5000,statement_timeout:30000,application_name:'ChutimaServer'});
  const version=Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num);
  if(version<180000||version>=190000)throw Error('ต้องใช้ PostgreSQL 18 ของชุติมา');
  const engine=new Engine(pool);await engine.init();
  await engine.transaction(async db=>{const old=(await db.query("SELECT body FROM chutima.entities WHERE collection='app' AND id='officeCapabilities'")).rows[0];if(old?.body?.version!==3)await engine.write(db,{collection:'app',key:'officeCapabilities',value:{version:3}},'office_upgrade_3');});
  const cloud=new CloudRelay({engine});await cloud.init();
  const backup=new ServerBackup({pool,config,base:path.dirname(file)});
  const server=createApi({engine,cloud,pairingKey:config.pairingKey,tls:{key:fs.readFileSync(path.resolve(path.dirname(file),config.tls.key)),cert:fs.readFileSync(path.resolve(path.dirname(file),config.tls.cert))}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.host||'0.0.0.0',resolve);});
  backup.start();
  cloud.start();
  let stopping=false;
  async function stop(){if(stopping)return;stopping=true;backup.stop();cloud.stop();await new Promise(resolve=>server.close(resolve));await Promise.allSettled([backup.running,cloud.running,cloud.registering]);await pool.end();}
  process.on('SIGTERM',()=>stop().finally(()=>process.exit()));process.on('SIGINT',()=>stop().finally(()=>process.exit()));
  console.log('Chutima server ready on port 8443');
  return {server,engine,pool,backup,stop};
}
if(require.main===module)start(process.env.CHUTIMA_SERVER_CONFIG||path.join(__dirname,'config','server.json')).catch(error=>{console.error('Chutima server startup failed:',/[ก-๙]/.test(error.message)?error.message:'ตรวจไฟล์ตั้งค่าและบริการฐานข้อมูลชุติมา');process.exitCode=1;});
module.exports={start};
