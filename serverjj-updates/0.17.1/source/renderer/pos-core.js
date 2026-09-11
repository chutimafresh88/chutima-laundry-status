'use strict';

// Shared rules for POS, inventory and isolated regression tests.
(function (host) {
  const clean = value => String(value ?? '').trim();
  const key = value => clean(value).toLocaleLowerCase();
  const money = value => Math.round(Number(value) * 100) / 100;
  const count = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 9999999;
  function nonnegative(value) { return clean(value) !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 99999999; }
  function products(state) { return Object.values(state.settings.products || {}); }
  function lookup(state, code) {
    const wanted = key(code);
    if (!wanted) return null;
    const found = products(state).filter(p => key(p.barcode) === wanted || key(p.sku) === wanted);
    if (found.length > 1) throw Error('รหัสนี้ตรงกับสินค้ามากกว่า 1 รายการ กรุณาแก้รหัสในตั้งค่า');
    return found[0] || null;
  }
  function validateProduct(state, p) {
    if (!clean(p.name) || !clean(p.sku) || !clean(p.unit)) throw Error('กรุณากรอกชื่อ รหัสสินค้า และหน่วยขาย');
    if (clean(p.name).length > 160 || clean(p.sku).length > 64 || clean(p.barcode).length > 128) throw Error('ชื่อหรือรหัสสินค้ายาวเกินไป');
    if (/[\u0000-\u001f\u007f]/.test(p.barcode || '')) throw Error('บาร์โค้ดมีอักขระที่ใช้ไม่ได้');
    if (![p.price, p.costPrice].every(nonnegative) || !count(p.lowStockAt) || !count(p.stockOnHand)) throw Error('ราคาและจำนวนต้องไม่ติดลบ จำนวนต้องเป็นจำนวนเต็ม');
    const ownCodes = [key(p.sku), key(p.barcode)].filter(Boolean);
    if (products(state).some(other => other.id !== p.id && [key(other.sku), key(other.barcode)].filter(Boolean).some(c => ownCodes.includes(c)))) throw Error('รหัสสินค้าหรือบาร์โค้ดนี้ถูกใช้แล้ว');
    return p;
  }
  function lines(state, quantities) {
    return Object.entries(quantities).filter(([,qty]) => Number(qty) !== 0).map(([id, qty]) => {
      const p = state.settings.products[id];
      if (!p || p.enabled === false) throw Error('มีสินค้าที่ปิดขายหรือไม่พบแล้ว กรุณาลบออกจากตะกร้า');
      if (!count(qty) || Number(qty) < 1) throw Error('จำนวนสินค้าต้องเป็นจำนวนเต็มมากกว่า 0');
      if (!nonnegative(p.price)) throw Error('ราคาสินค้าไม่ถูกต้อง');
      if (p.trackStock !== false && qty > Number(p.stockOnHand || 0)) throw Error(`${p.name} คงเหลือ ${p.stockOnHand} ${p.unit}`);
      return { productId: id, sku: p.sku, barcode: p.barcode || '', label: p.name, unit: p.unit,
        quantity: Number(qty), unitPrice: money(p.price), unitCost: Number(p.costPrice || 0),
        tracked: p.trackStock !== false, amount: money(Number(qty) * money(p.price)) };
    });
  }
  function remaining(state, sale, item) {
    const returned = (state.productReturns || []).filter(r => r.saleId === sale.id).flatMap(r => r.items).filter(i => i.productId === item.productId).reduce((sum,i) => sum + i.quantity, 0);
    return Math.max(0, item.quantity - returned);
  }
  function refundLines(state, sale, selected) {
    const results = sale.items.flatMap(item => {
      const request = selected[item.productId];
      if (!request || Number(request.quantity) === 0) return [];
      if (!count(request.quantity) || request.quantity < 1 || request.quantity > remaining(state, sale, item)) throw Error('จำนวนคืนเกินจำนวนที่ยังคืนได้');
      if (!['restock','damaged'].includes(request.condition)) throw Error('กรุณาระบุสภาพสินค้าที่คืน');
      return [{ ...item, quantity: Number(request.quantity), condition: request.condition, amount: money(request.quantity * item.unitPrice) }];
    });
    if (!results.length) throw Error('กรุณาเลือกจำนวนสินค้าที่จะคืน');
    return results;
  }
  const api = { clean, key, money, count, nonnegative, products, lookup, validateProduct, lines, remaining, refundLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else host.POS = Object.freeze(api);
})(globalThis);
