import assert from 'node:assert/strict';
import {calculatePack,previewPack} from '../app/purchase-packs.ts';
const line={productId:'test',packCount:'2',piecesPerPack:'12',packCost:'96'};
assert.deepEqual(calculatePack(line),{productId:'test',quantity:24,unitCost:8,packCount:2,piecesPerPack:12,packCost:96,total:192});
assert.equal(calculatePack({...line,packCost:'100'}).unitCost,100/12);
assert.equal(calculatePack({...line,piecesPerPack:'1'}).quantity,2);
for(const value of ['', '0','-1','1.5','NaN','Infinity','10000000']){
 assert.throws(()=>calculatePack({...line,packCount:value}));
 assert.throws(()=>calculatePack({...line,piecesPerPack:value}));
}
for(const value of ['', '-1','NaN','Infinity','100000000'])assert.throws(()=>calculatePack({...line,packCost:value}));
assert.throws(()=>calculatePack({...line,packCount:'9999999'}));
assert.throws(()=>calculatePack({...line,packCost:'99999999'}));
assert.equal(previewPack({...line,piecesPerPack:''}),null);
assert.equal(calculatePack({...line,packCost:'0'}).unitCost,0);
console.log('Pack conversion and invalid-input checks passed');
