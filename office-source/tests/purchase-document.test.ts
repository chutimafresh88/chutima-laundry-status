import fs from 'node:fs';
import assert from 'node:assert/strict';
import {purchaseDocumentHtml} from '../app/purchase-document';
const supplier:any={id:'s1',code:'SUP-001',name:'บริษัท ผู้จำหน่ายตัวอย่าง จำกัด',address:'123 ถนนตัวอย่าง แขวงทดสอบ เขตตัวอย่าง กรุงเทพมหานคร 10240',taxId:'0123456789012',phone:'02-123-4567',active:true};
const shop:any={name:'ร้านตัวอย่าง',address:'99 ถนนทดสอบ กรุงเทพมหานคร 10240',phone:'02-000-0000',taxId:'0000000000000',branch:'สำนักงานใหญ่',footer:'กรุณาตรวจสอบสินค้าและจำนวนก่อนลงชื่อรับสินค้า'};
const order:any={id:'o1',orderNo:'PO-20260911-001',supplierId:'s1',supplierName:supplier.name,createdAt:'2026-09-11',expectedDate:'2026-09-15',status:'OPEN',total:480,subtotal:480,taxMode:'none',items:[{name:'คาราบาว',sku:'666666',quantity:12,received:0,unitCost:98/12,packCount:1,piecesPerPack:12,packCost:98},{name:'M150',sku:'111666',quantity:20,received:0,unitCost:9.6,packCount:2,piecesPerPack:10,packCost:96},{name:'น้ำดื่ม',sku:'111111',quantity:30,received:0,unitCost:95/15,packCount:2,piecesPerPack:15,packCost:95}]};
const receipt:any={...order,purchaseNo:'GR-20260911-001',supplierSnapshot:{name:supplier.name},documentNo:'INV-001',paidAmount:100,balance:380};delete receipt.supplierName;
const logo='data:image/jpeg;base64,'+fs.readFileSync('work/chutima-backoffice/public/logo.jpg').toString('base64');
fs.mkdirSync('outputs/purchase-print',{recursive:true});
for(const [name,doc] of [['order',order],['receipt',receipt],['multipage',{...order,items:Array.from({length:24},(_,i)=>({...order.items[i%3],name:'สินค้าทดสอบ '+(i+1)}))}]] as const){const html=purchaseDocumentHtml(doc,shop,supplier,logo);assert.ok(html.includes(supplier.taxId));assert.ok(html.includes(supplier.address));assert.ok(!html.includes('undefined'));fs.writeFileSync('outputs/purchase-print/'+name+'.html',html);}
const historical=purchaseDocumentHtml({...order,supplierSnapshot:{taxId:'9999999999999',address:'ที่อยู่เดิม'}},shop,supplier);
assert.ok(historical.includes('9999999999999'));assert.ok(!historical.includes(supplier.taxId));
assert.ok(purchaseDocumentHtml({...order,notes:'<script>bad</script>'},shop,supplier).includes('&lt;script&gt;'));
console.log('Supplier fields, historical fallback and escaped document text passed');
