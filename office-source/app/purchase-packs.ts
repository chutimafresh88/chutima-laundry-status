export type PackLine={productId:string;packCount:string;piecesPerPack:string;packCost:string};
export const newPackLine=():PackLine=>({productId:'',packCount:'1',piecesPerPack:'',packCost:''});
export function calculatePack(line:PackLine){
  const count=(value:string,label:string)=>{const n=Number(value);if(!value.trim()||!Number.isSafeInteger(n)||n<1||n>9999999)throw Error(`${label}ต้องเป็นจำนวนเต็มมากกว่า 0`);return n;};
  const packCount=count(line.packCount,'จำนวนแพ็ก'),piecesPerPack=count(line.piecesPerPack,'ชิ้นต่อแพ็ก');
  const packCost=Number(line.packCost);
  if(!line.packCost.trim()||!Number.isFinite(packCost)||packCost<0||packCost>99999999)throw Error('ราคาต่อแพ็กไม่ถูกต้อง');
  const quantity=packCount*piecesPerPack,total=packCount*packCost;
  if(!Number.isSafeInteger(quantity)||quantity>9999999)throw Error('จำนวนชิ้นรวมเกินขอบเขต');
  if(!Number.isFinite(total)||total>99999999)throw Error('ยอดซื้อรวมเกินขอบเขต');
  // Keep division precision until the existing purchase engine rounds money.
  return {productId:line.productId,quantity,unitCost:packCost/piecesPerPack,packCount,piecesPerPack,packCost,total};
}
export function previewPack(line:PackLine){try{return calculatePack(line);}catch{return null;}}
