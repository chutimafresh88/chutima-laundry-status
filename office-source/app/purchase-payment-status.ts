export const bangkokToday=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
type Receipt={status?:string;balance?:number|null;dueDate?:string};
export function purchasePaymentStatus(receipt:Receipt,today=bangkokToday()){
 if(receipt.status==='CANCELLED')return {kind:'cancelled',label:'ยกเลิกเอกสาร',days:null};
 if(receipt.balance==null||!Number.isFinite(Number(receipt.balance)))return {kind:'unknown',label:'รอตรวจสอบยอดชำระ',days:null};
 if(Math.round(Number(receipt.balance)*100)<=0)return {kind:'paid',label:'ชำระหนี้แล้ว',days:null};
 const date=receipt.dueDate?.slice(0,10)||'';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)return {kind:'undated',label:'ยังไม่กำหนดวันชำระ',days:null};
 const days=Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000);
 return days>0?{kind:'credit',label:`รอครบเครดิต · เหลือ ${days} วัน`,days}:days===0?{kind:'today',label:'ครบกำหนดวันนี้',days}:{kind:'overdue',label:`เกินกำหนด ${-days} วัน`,days};
}
