'use strict';
const fs=require('node:fs'),path=require('node:path');
const {ServerBackup}=require('../backup.cjs');
const file=path.resolve(process.argv[2]),config=JSON.parse(fs.readFileSync(file,'utf8'));
if(config.database?.host!=='127.0.0.1'||config.database.port!==5433||config.database.database!=='chutima'||config.port!==8443)throw Error('ต้องใช้ฐานข้อมูลชุติมาที่แยกไว้เท่านั้น');
new ServerBackup({config,base:path.dirname(file)}).create().then(()=>console.log('Chutima backup verified')).catch(()=>{console.error('สำรองชุติมาก่อนอัปเดตไม่สำเร็จ');process.exitCode=1;});
