'use strict';
const http=require('node:http');
const https=require('node:https');
const crypto=require('node:crypto');
const {URL}=require('node:url');
const sha=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
function same(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
async function body(req,max=24*1024*1024){
  if(!/^application\/json\b/i.test(req.headers['content-type']||''))throw Error('ต้องส่งข้อมูล JSON');
  const chunks=[];let length=0;
  for await(const chunk of req){length+=chunk.length;if(length>max){const e=Error('ข้อมูลใหญ่เกินกำหนด');e.status=413;throw e;}chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function createApi({engine,tls,pairingKey,cloud,allowTestHttp=false,onStatus=()=>{}}){
  if(!tls&&!allowTestHttp)throw Error('บริการใช้งานจริงต้องเชื่อมต่อแบบ HTTPS');
  if(typeof pairingKey!=='string'||pairingKey.length<32)throw Error('ยังไม่ได้ตั้งค่าจับคู่เครื่อง');
  const attempts=new Map();
  const handler=async(req,res)=>{
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    try{
      // No browser credentials or cross-origin LAN calls are accepted.
      if(req.headers.origin){send(403,{error:'ใช้โปรแกรม POS ที่จับคู่แล้ว'});return;}
      const url=new URL(req.url,'https://localhost');
      if(req.method==='GET'&&url.pathname==='/health'){send(200,{service:'chutima-server',protocol:1,version:'0.17.1'});return;}
      if(req.method==='POST'&&url.pathname==='/pair'){
        const address=req.socket.remoteAddress,now=Date.now();
        const attempt=attempts.get(address)||{start:now,count:0};
        if(now-attempt.start>60000){attempt.start=now;attempt.count=0;}attempt.count++;attempts.set(address,attempt);
        if(attempt.count>10){send(429,{error:'กรุณารอก่อนจับคู่อีกครั้ง'});return;}
        if(!same(req.headers.authorization,'Bearer '+pairingKey)){send(401,{error:'รหัสจับคู่ไม่ถูกต้อง'});return;}
        const data=await body(req,16384);
        if(!/^[A-Za-z0-9_-]{43,128}$/.test(data.key||''))throw Error('ข้อมูลจับคู่ไม่ถูกต้อง');
        const existing=await engine.device(data.id);
        if(existing&&!same(existing.key_hash,sha(data.key))){send(409,{error:'เครื่องนี้จับคู่ไว้แล้ว กรุณาใช้การเชื่อมต่อเดิม'});return;}
        const device=await engine.register({id:data.id,label:data.label,keyHash:sha(data.key)});
        const initialized=(await engine.pool.query('SELECT initialized FROM chutima.coordination WHERE id=1')).rows[0].initialized;
        send(200,{...device,initialized});return;
      }
      const device=await engine.device(req.headers['x-chutima-device']);
      const bearer=/^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(req.headers.authorization||'');
      if(!device||!bearer||!same(device.key_hash,sha(bearer[1]))){send(401,{error:'เครื่องนี้ยังไม่ได้รับสิทธิ์'});return;}
      if(req.method==='GET'&&url.pathname==='/device'){
        const pending=url.searchParams.has('pending')?Number(url.searchParams.get('pending')):null;
        if(pending!==null&&(!Number.isSafeInteger(pending)||pending<0||pending>9999999))throw Error('จำนวนรายการรอส่งไม่ถูกต้อง');
        await engine.pool.query('UPDATE chutima.devices SET last_seen=now(),reported_pending=coalesce($1,reported_pending) WHERE id=$2',[pending,device.id]);
        send(200,{id:device.id,label:device.label,slot:device.slot,lastSequence:Number(device.last_sequence),stockReleases:true,...(cloud?{cloud:cloud.status()}:{})});return;
      }
      if(req.method==='GET'&&url.pathname==='/devices'){
        const devices=(await engine.pool.query('SELECT id,label,slot,last_seen FROM chutima.devices WHERE enabled=true ORDER BY slot')).rows;
        send(200,{devices});return;
      }
      if(req.method==='GET'&&url.pathname==='/stock-releases'){
        const releases=(await engine.pool.query('SELECT w.id AS "commandId",w.product_id AS "productId" FROM chutima.web_commands w LEFT JOIN chutima.web_results r ON r.id=w.id WHERE r.id IS NULL AND w.product_id IS NOT NULL ORDER BY w.created_at,w.id LIMIT 100')).rows;
        send(200,{releases});return;
      }
      if(req.method==='POST'&&url.pathname==='/cloud/register'&&cloud){
        if(device.slot!==1){send(403,{error:'เชื่อมบัญชีเว็บที่ POS หลักเท่านั้น'});return;}
        const data=await body(req,20000);send(200,await cloud.register(data.ownerToken));return;
      }
      if(req.method==='POST'&&url.pathname==='/operations'){
        const operation=await body(req);
        if(operation.deviceId!==device.id){send(403,{error:'ไม่สามารถส่งรายการแทนอีกเครื่อง'});return;}
        const result=await engine.apply(operation);onStatus();send(200,result);return;
      }
      if(req.method==='GET'&&url.pathname==='/changes'){
        send(200,await engine.pull(device.id,Number(url.searchParams.get('after')||0),Number(url.searchParams.get('limit')||500)));return;
      }
      send(404,{error:'ไม่พบรายการที่ขอ'});
    }catch(error){
      const status=error.status||((error.code==='CONFLICT'||/ลำดับรายการ|ข้อมูลตั้งต้นทับ/.test(error.message))?409:400);
      // Only domain messages are returned; SQL/driver errors can contain records.
      send(status,{error:/[ก-๙]/.test(error.message)?error.message:'บันทึกข้อมูลไม่สำเร็จ กรุณาตรวจสถานะเซิร์ฟเวอร์'});
    }
  };
  const server=tls?https.createServer({...tls,minVersion:'TLSv1.2'},handler):http.createServer(handler);
  server.requestTimeout=45000;server.headersTimeout=10000;server.maxRequestsPerSocket=100;
  return server;
}
module.exports={createApi,sha};
