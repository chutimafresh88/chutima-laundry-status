'use strict';
const https=require('node:https');
const fs=require('node:fs');
const [ip,caFile]=process.argv.slice(2);
const ca=fs.readFileSync(caFile);
function check(){return new Promise((resolve,reject)=>{
  const req=https.get({hostname:ip,port:8443,path:'/health',ca,rejectUnauthorized:true,timeout:2000},res=>{
    let data='';res.on('data',b=>{data+=b;if(data.length>4096)res.destroy(Error('response too large'));});res.on('error',reject);
    res.on('end',()=>{try{const value=JSON.parse(data);if(res.statusCode!==200||value.service!=='chutima-server'||value.protocol!==1)throw Error('Unexpected service');resolve();}catch(e){reject(e);}});
  });req.on('timeout',()=>req.destroy(Error('timeout')));req.on('error',reject);
});}
(async()=>{for(let i=0;i<30;i++){try{await check();console.log('Chutima HTTPS service is ready');return;}catch{await new Promise(r=>setTimeout(r,1000));}}throw Error('ตัวเชื่อมต่อชุติมายังไม่พร้อม กรุณาตรวจบันทึกใน E:\\ChutimaData\\Logs-Chutima');})().catch(e=>{console.error(e.message);process.exitCode=1;});
