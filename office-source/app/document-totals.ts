export type TaxMode='none'|'inclusive'|'exclusive';
export function documentTotals(subtotal:number,discount:number,shipping:number,taxMode:TaxMode='none',taxRate=0){
 if(![subtotal,discount,shipping,taxRate].every(n=>Number.isFinite(n)&&n>=0)||discount>subtotal||taxRate>100||!['none','inclusive','exclusive'].includes(taxMode))throw Error('ตรวจยอดสินค้า ส่วนลด ค่าส่ง และอัตรา VAT');
 const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100,amount=round(subtotal-discount+shipping);
 const taxAmount=taxMode==='inclusive'?round(amount-amount/(1+taxRate/100)):taxMode==='exclusive'?round(amount*taxRate/100):0;
 return {subtotal:round(subtotal),discount,shipping,taxMode,taxRate:taxMode==='none'?0:taxRate,taxableAmount:taxMode==='inclusive'?round(amount-taxAmount):amount,taxAmount,total:taxMode==='exclusive'?round(amount+taxAmount):amount};
}
export const taxLabels={none:'ไม่มี VAT',inclusive:'รวม VAT',exclusive:'แยก VAT'};
