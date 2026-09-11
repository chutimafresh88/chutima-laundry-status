'use strict';

const crypto = require('node:crypto');
const INVALID_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const LOCAL_SETTINGS = new Set(['printerName', 'printingEnabled', 'silentPrint', 'fontScale', 'fullscreen']);
const OWNED = new Set(['queues', 'productSales', 'productReturns', 'shifts', 'cashDrawerTransactions', 'purchases', 'purchaseOrders', 'supplierReturns','documentHistory']);
const APPEND_ONLY = new Set(['inventoryMovements', 'auditLogs']);
const COUNT_LIMIT = 9999999;
const BUSINESS_COLLECTIONS = ['employees','queues','productSales','productReturns','inventoryMovements','suppliers','purchases','cashDrawerTransactions','customers','promotions','shifts','auditLogs'];

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(v => canonical(v) ?? 'null').join(',') + ']';
  return '{' + Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
function hash(value) { return crypto.createHash('sha256').update(canonical(value)).digest('hex'); }
function id(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value) && !INVALID_KEYS.has(value); }
function assertCount(value, label = 'จำนวนสินค้า') {
  if (!Number.isSafeInteger(value) || value < 0 || value > COUNT_LIMIT) throw Error(`${label}ต้องเป็นจำนวนเต็มตั้งแต่ 0 ถึง ${COUNT_LIMIT}`);
  return value;
}
function entityKey(collection, key) {
  if (!id(collection) || !id(key)) throw Error('รหัสข้อมูลไม่ถูกต้อง');
  return collection + '/' + key;
}

// App metadata and hardware settings stay on their device. All business fields,
// including fields added by later app versions, are represented explicitly.
function entities(state) {
  const result = new Map();
  const put = (collection, key, value) => {
    const k = entityKey(collection, key);
    if (result.has(k)) throw Error(`รหัสข้อมูลซ้ำ: ${k}`);
    result.set(k, { collection, key, value: structuredClone(value) });
  };
  for (const [field, value] of Object.entries(state || {})) {
    if (field === 'meta' || field === 'settings') continue;
    if (Array.isArray(value)) {
      for (const record of value) {
        if (!record || !id(record.id)) throw Error(`ข้อมูล ${field} ไม่มีรหัสที่ใช้ซิงค์ได้`);
        put(field, record.id, record);
      }
    } else put('app', field, value);
  }
  for (const [field, value] of Object.entries(state.settings || {})) {
    if (field === 'products') {
      for (const [key, product] of Object.entries(value || {})) put('products', key, product);
    } else if (!LOCAL_SETTINGS.has(field)) put('settings', field, value);
  }
  return result;
}

function changes(previous, next) {
  const before = entities(previous), after = entities(next), result = [];
  for (const [key, record] of after) {
    const original = before.get(key);
    if (!original || canonical(original.value) !== canonical(record.value)) {
      result.push({ ...record, before: original ? original.value : null, beforeHash: original ? hash(original.value) : null });
    }
  }
  for (const [key, record] of before) {
    // Old POS versions trim display history. A display window must never erase
    // the central archive, so omission of these records is not a deletion.
    if (!after.has(key) && !APPEND_ONLY.has(record.collection)) result.push({ ...record, before: record.value, beforeHash: hash(record.value), value: null });
  }
  return result.sort((a, b) => entityKey(a.collection, a.key).localeCompare(entityKey(b.collection, b.key)));
}

function applyRecords(state, records) {
  const next = structuredClone(state);
  for(const collection of BUSINESS_COLLECTIONS)if(!Array.isArray(next[collection]))next[collection]=[];
  for (const record of records) {
    const { collection, key, value } = record;
    entityKey(collection, key);
    if (collection === 'products') {
      next.settings ||= {}; next.settings.products ||= {};
      if (value === null) delete next.settings.products[key]; else next.settings.products[key] = structuredClone(value);
    } else if (collection === 'settings') {
      if (LOCAL_SETTINGS.has(key)) continue;
      next.settings ||= {};
      if (value === null) delete next.settings[key]; else next.settings[key] = structuredClone(value);
    } else if (collection === 'app') {
      if (['meta', 'settings'].includes(key)) throw Error('ไม่อนุญาตให้ทับข้อมูลประจำเครื่อง');
      if (value === null) delete next[key]; else next[key] = structuredClone(value);
    } else {
      if (!Array.isArray(next[collection])) next[collection] = [];
      const index = next[collection].findIndex(item => item.id === key);
      if (value === null) { if (index >= 0) next[collection].splice(index, 1); }
      else if (index >= 0) next[collection][index] = structuredClone(value);
      else next[collection].unshift(structuredClone(value));
    }
  }
  return next;
}

function stampOwners(previous, state, deviceId) {
  if (!id(deviceId)) throw Error('รหัสเครื่องไม่ถูกต้อง');
  for (const collection of OWNED) {
    const old = new Map((previous[collection] || []).map(row => [row.id, row]));
    for (const row of state[collection] || []) {
      const original = old.get(row.id);
      row.deviceId = original?.deviceId || deviceId;
      if (original?.deviceId && original.deviceId !== deviceId && canonical(original) !== canonical(row)) {
        throw Error('รายการนี้เป็นของ POS อีกเครื่อง กรุณาทำรายการที่เครื่องเจ้าของงาน');
      }
    }
    for (const original of old.values()) {
      if (original.deviceId && original.deviceId !== deviceId && !(state[collection] || []).some(row => row.id === original.id)) throw Error('ไม่สามารถลบรายการของ POS อีกเครื่อง');
    }
  }
  for(const row of state.productReturns||[]){
    if((previous.productReturns||[]).some(old=>old.id===row.id))continue;
    const sale=(previous.productSales||[]).find(s=>s.id===row.saleId);
    if(sale?.deviceId&&sale.deviceId!==deviceId)throw Error('กรุณาคืนสินค้าที่ POS เครื่องที่ออกบิล เพื่อป้องกันคืนเงินซ้ำ');
  }
  return state;
}

function validateStocks(previous, next) {
  for (const [key, product] of Object.entries(next.settings?.products || {})) {
    if (!id(key) || product.id !== key) throw Error('รหัสสินค้าไม่ตรงกัน');
    assertCount(Number(product.stockOnHand), product.name || 'สต๊อก');
    if (previous.settings?.products?.[key]?.trackStock !== false && product.trackStock === false) throw Error('ไม่สามารถปิดตรวจสต๊อกเพื่อขายเกินจำนวน');
  }
}

function stockDeltas(previous, next) {
  const result = {};
  for (const key of new Set([...Object.keys(previous.settings?.products || {}), ...Object.keys(next.settings?.products || {})])) {
    const a = previous.settings?.products?.[key], b = next.settings?.products?.[key];
    if ((b || a)?.trackStock === false) continue;
    const delta = Number(b?.stockOnHand || 0) - Number(a?.stockOnHand || 0);
    if (delta) result[key] = delta;
  }
  return result;
}

module.exports = { canonical, hash, id, assertCount, entityKey, entities, changes, applyRecords, stampOwners, validateStocks, stockDeltas, LOCAL_SETTINGS, OWNED, APPEND_ONLY };
