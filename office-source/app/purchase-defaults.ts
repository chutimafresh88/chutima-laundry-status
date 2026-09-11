import type {Product,Purchase,PurchaseOrder,Snapshot} from './office-api';
import type {TaxMode} from './document-totals';
import type {PackLine} from './purchase-packs';
const packSize=(value:unknown)=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):1;
const price=(value:number)=>String(Number(value.toFixed(6)));
// Document history is central and survives browser/device changes. Drafts and
// rejected/cancelled documents never become defaults for the next purchase.
export function purchaseDefaults(product:Product,snapshot:Snapshot,supplierId:string,taxMode:TaxMode='none',taxRate=0){
 const docs:(Purchase|PurchaseOrder)[]=[...(snapshot.purchaseOrders||[]),...snapshot.purchases];
 const candidates=docs.filter(d=>d.status!=='CANCELLED'&&(!supplierId||d.supplierId===supplierId)&&d.items.some(i=>i.productId===product.id)).sort((a,b)=>(('purchaseNo' in b?b.createdAt:b.updatedAt)||b.createdAt).localeCompare(('purchaseNo' in a?a.createdAt:a.updatedAt)||a.createdAt)||b.id.localeCompare(a.id));
 const source=candidates[0],item=source?.items.find(i=>i.productId===product.id);
 const size=packSize(item?.piecesPerPack??product.packSize);
 let cost=item?Number(item.packCost!=null&&item.piecesPerPack===size?item.packCost:Number(item.unitCost)*size):product.costPrice*size;
 // Stock average cost is gross. Convert remembered quoted prices when the
 // next document uses a different VAT basis, without changing its VAT choice.
 if(source?.taxMode==='exclusive')cost*=1+Number(source.taxRate||0)/100;
 if(taxMode==='exclusive')cost/=1+taxRate/100;
 if(!Number.isFinite(cost)||cost<0)cost=0;
 return {productId:product.id,packCount:'1',piecesPerPack:String(size),packCost:price(cost),source:source?('purchaseNo' in source?source.purchaseNo:source.orderNo):null};
}
export function documentPackLine(item:{productId?:string;quantity:number;unitCost:number;piecesPerPack?:number;packCost?:number},quantity=item.quantity):PackLine{
 const size=packSize(item.piecesPerPack),wholePacks=quantity%size===0;
 return {productId:item.productId||'',packCount:String(wholePacks?quantity/size:quantity),piecesPerPack:String(wholePacks?size:1),packCost:price(wholePacks?(item.packCost??item.unitCost*size):item.unitCost)};
}
