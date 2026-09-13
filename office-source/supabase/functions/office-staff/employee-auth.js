'use strict';
(function(host,factory){const api=factory();host.EmployeeAuth=api;if(typeof module==='object'&&module.exports)module.exports=api;})(globalThis,function(){
  const hex=bytes=>Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
  const bytes=hex=>Uint8Array.from(hex.match(/../g)||[],n=>parseInt(n,16));
  const valid=v=>v?.algorithm==='PBKDF2-SHA256'&&v.iterations===210000&&/^[a-f0-9]{32}$/.test(v.salt)&&/^[a-f0-9]{64}$/.test(v.hash);
  async function derive(password,salt){const key=await globalThis.crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);return hex(new Uint8Array(await globalThis.crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:bytes(salt),iterations:210000},key,256)));}
  async function hashPassword(password){if(typeof password!=='string'||password.length<6||password.length>128)throw Error('รหัสผ่านต้องยาว 6–128 ตัวอักษร');const salt=hex(globalThis.crypto.getRandomValues(new Uint8Array(16)));return {algorithm:'PBKDF2-SHA256',iterations:210000,salt,hash:await derive(password,salt)};}
  async function verify(employee,password){if(!employee||employee.active===false||typeof password!=='string')return false;if(!employee.passwordVerifier)return !!employee.pin&&employee.pin===password;if(!valid(employee.passwordVerifier))return false;const actual=await derive(password,employee.passwordVerifier.salt);let diff=0;for(let i=0;i<actual.length;i++)diff|=actual.charCodeAt(i)^employee.passwordVerifier.hash.charCodeAt(i);return diff===0;}
  return {hashPassword,verify,valid};
});
