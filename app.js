'use strict';

const CONFIG = globalThis.__LAUNDRY_PUBLIC_CONFIG__ || {};
const STATUS_STEPS = ['รับผ้าแล้ว', 'กำลังทำ', 'พร้อมรับ', 'ส่งมอบแล้ว'];
const STATUS_COPY = {
  WAITING: {
    label: 'รอเริ่มงาน', symbol: '⌛', kicker: 'ร้านรับผ้าเรียบร้อยแล้ว',
    title: 'กำลังรอเริ่มงาน', description: 'ยังไม่ควรเดินทางมารับ ร้านจะอัปเดตเวลาเมื่อเริ่มทำงาน', stage: 0
  },
  WORKING: {
    label: 'กำลังดำเนินการ', symbol: '🫧', kicker: 'กำลังซัก–อบให้คุณ',
    title: 'งานกำลังดำเนินการ', description: 'เวลารับโดยประมาณยึดจากตะกร้าที่เสร็จช้าที่สุด', stage: 1
  },
  READY: {
    label: 'พร้อมรับผ้า', symbol: '✓', kicker: 'งานของคุณเสร็จแล้ว',
    title: 'เข้ามารับผ้าได้เลย', description: 'ผ้าทุกตะกร้าตรวจเรียบร้อยและกำลังรอส่งมอบให้คุณ', stage: 2
  },
  COMPLETED: {
    label: 'ส่งมอบแล้ว', symbol: '✓', kicker: 'ขอบคุณที่ใช้บริการ',
    title: 'รับผ้าเรียบร้อยแล้ว', description: 'คิวนี้ส่งมอบครบทุกตะกร้าแล้ว ลิงก์จะหมดอายุโดยอัตโนมัติ', stage: 3
  },
  CANCELLED: {
    label: 'ยกเลิกคิว', symbol: '×', kicker: 'คิวนี้ถูกยกเลิก',
    title: 'ไม่มีงานที่กำลังดำเนินการ', description: 'หากไม่ได้เป็นผู้แจ้งยกเลิก กรุณาติดต่อร้าน', stage: -1
  }
};

const elements = {
  notice: document.querySelector('[data-config-notice]'),
  queueNumber: document.querySelector('[data-queue-number]'),
  createdTime: document.querySelector('[data-created-time]'),
  basketCount: document.querySelector('[data-basket-count]'),
  hero: document.querySelector('[data-status-hero]'),
  symbol: document.querySelector('[data-status-symbol]'),
  kicker: document.querySelector('[data-status-kicker]'),
  title: document.querySelector('[data-status-title]'),
  description: document.querySelector('[data-status-description]'),
  pickupCard: document.querySelector('[data-pickup-card]'),
  pickupLabel: document.querySelector('[data-pickup-label]'),
  pickupTime: document.querySelector('[data-pickup-time]'),
  pickupNote: document.querySelector('[data-pickup-note]'),
  progress: document.querySelector('[data-progress]'),
  basketList: document.querySelector('[data-basket-list]'),
  basketSummary: document.querySelector('[data-basket-summary]'),
  lastUpdate: document.querySelector('[data-last-update]'),
  refresh: document.querySelector('[data-refresh]'),
  toast: document.querySelector('[data-toast]'),
  phone: document.querySelector('[data-phone-action]'),
  map: document.querySelector('[data-map-action]')
};

let lastPayload = null;
let lastFetchedAt = null;
let refreshTimer = null;
let toastTimer = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function queueToken() {
  const queryToken = new URLSearchParams(location.search).get('token');
  if (queryToken) return queryToken;
  const match = location.pathname.match(/\/q\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : '';
}

function formatTime(value) {
  if (!value) return 'ยังประเมินไม่ได้';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'ยังประเมินไม่ได้';
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date) + ' น.';
}

function serviceLabel(item) {
  const washProgram = { cold: 'น้ำเย็น', warm: 'น้ำอุ่น', hot: 'น้ำร้อน', delicate: 'ถนอมผ้า' };
  const dryHeat = { noHeat: 'ไม่ใช้ความร้อน', low: 'อุณหภูมิต่ำ', medium: 'ปานกลาง', high: 'อุณหภูมิสูง' };
  if (item.service_type === 'wash') return ['ซัก', item.wash_size ? `${item.wash_size} kg` : '', washProgram[item.wash_program] || ''].filter(Boolean).join(' · ');
  if (item.service_type === 'dry') return ['อบ', item.dry_size ? `${item.dry_size} kg` : '', dryHeat[item.dry_heat] || ''].filter(Boolean).join(' · ');
  if (item.service_type === 'washDry') return ['ซัก–อบ', item.wash_size ? `${item.wash_size} kg` : '', item.finish === 'dryFold' ? 'พับ' : 'ไม่พับ'].filter(Boolean).join(' · ');
  return 'รอระบุบริการ';
}

function basketProgress(item) {
  if (['READY', 'COMPLETED'].includes(item.status)) return 100;
  if (item.status !== 'WORKING' || !item.started_at || !item.expected_end_at) return 0;
  const start = new Date(item.started_at).getTime();
  const end = new Date(item.expected_end_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.max(1, Math.min(99, Math.round(((Date.now() - start) / (end - start)) * 100)));
}

function basketStatus(item) {
  if (item.status === 'WAITING') return { text: 'รอเริ่มงาน', time: '', css: 'waiting' };
  if (item.status === 'WORKING') return { text: 'กำลังทำ', time: item.expected_end_at ? `เสร็จประมาณ ${formatTime(item.expected_end_at)}` : '', css: 'working' };
  if (item.status === 'READY') return { text: 'พร้อมรับ', time: item.ready_at ? `เสร็จ ${formatTime(item.ready_at)}` : '', css: 'ready' };
  if (item.status === 'COMPLETED') return { text: 'ส่งมอบแล้ว', time: '', css: 'ready' };
  return { text: 'ยกเลิกแล้ว', time: '', css: 'cancelled' };
}

function renderProgress(stage, cancelled) {
  return STATUS_STEPS.map((label, index) => {
    const done = !cancelled && index < stage;
    const active = !cancelled && index === stage;
    return `<div class="progress-step ${done ? 'done' : ''} ${active ? 'active' : ''}"><span class="progress-dot">${done ? '✓' : index + 1}</span><span>${label}</span></div>`;
  }).join('');
}

function renderBasket(item) {
  const status = basketStatus(item);
  const progress = basketProgress(item);
  const progressHtml = progress > 0 && progress < 100
    ? `<div class="basket-progress" aria-label="ความคืบหน้า ${progress} เปอร์เซ็นต์"><i style="--progress:${progress}%"></i></div>` : '';
  return `<article class="basket-card ${status.css}">
    <div class="basket-number">${Number(item.basket_number || 0)}</div>
    <div class="basket-main"><strong>ตะกร้า ${Number(item.basket_number || 0)}</strong><p>${escapeHtml(serviceLabel(item))}</p>${progressHtml}</div>
    <div class="basket-status"><strong>${status.text}</strong>${status.time ? `<small>${escapeHtml(status.time)}</small>` : ''}</div>
  </article>`;
}

function pickupCopy(payload) {
  if (payload.status === 'READY') return ['สถานะการรับผ้า', 'พร้อมรับแล้ว', payload.ready_at ? `พร้อมรับตั้งแต่ ${formatTime(payload.ready_at)}` : 'กรุณาแสดง QR นี้กับพนักงาน', 'ready'];
  if (payload.status === 'COMPLETED') return ['เวลาส่งมอบ', formatTime(payload.completed_at), 'คิวนี้ส่งมอบเรียบร้อยแล้ว', 'muted'];
  if (payload.status === 'CANCELLED') return ['สถานะคิว', 'ยกเลิกแล้ว', 'กรุณาติดต่อร้านหากต้องการความช่วยเหลือ', 'danger'];
  if (payload.recommended_pickup_at) return ['เวลาที่แนะนำให้มารับ', `ประมาณ ${formatTime(payload.recommended_pickup_at)}`, 'ระบบเผื่อเวลาตรวจและจัดผ้าหลังเครื่องทำงานเสร็จ', ''];
  return ['เวลาที่แนะนำให้มารับ', 'ยังประเมินไม่ได้', 'เมื่อเริ่มงาน ระบบจะแสดงเวลารับโดยประมาณ', 'muted'];
}

function summaryText(baskets) {
  const counts = baskets.reduce((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, {});
  if (counts.CANCELLED === baskets.length) return `ยกเลิก ${baskets.length} ตะกร้า`;
  if ((counts.READY || 0) + (counts.COMPLETED || 0) === baskets.length) return `${baskets.length}/${baskets.length} ตะกร้าเสร็จแล้ว`;
  return [`${counts.WORKING || 0} กำลังทำ`, `${counts.READY || 0} เสร็จแล้ว`].join(' · ');
}

function render(payload) {
  lastPayload = payload;
  const copy = STATUS_COPY[payload.status] || STATUS_COPY.WAITING;
  const baskets = Array.isArray(payload.baskets) ? payload.baskets : [];
  const pickup = pickupCopy(payload);
  elements.queueNumber.textContent = payload.queue_number || '—';
  elements.createdTime.textContent = formatTime(payload.created_at);
  elements.basketCount.textContent = `${Number(payload.basket_count || baskets.length)} ตะกร้า`;
  elements.hero.className = `status-hero ${payload.status.toLowerCase()}`;
  elements.symbol.textContent = copy.symbol;
  elements.kicker.textContent = copy.kicker;
  elements.title.textContent = copy.title;
  elements.description.textContent = copy.description;
  elements.pickupCard.className = `pickup-card ${pickup[3]}`.trim();
  elements.pickupLabel.textContent = pickup[0];
  elements.pickupTime.textContent = pickup[1];
  elements.pickupNote.textContent = pickup[2];
  elements.progress.innerHTML = renderProgress(copy.stage, payload.status === 'CANCELLED');
  elements.basketList.innerHTML = baskets.map(renderBasket).join('');
  elements.basketSummary.textContent = summaryText(baskets);
  updateLastSeen();
}

function renderError(kind) {
  const configMissing = kind === 'config';
  elements.queueNumber.textContent = '—';
  elements.createdTime.textContent = '—';
  elements.basketCount.textContent = '—';
  elements.hero.className = 'status-hero cancelled';
  elements.symbol.textContent = configMissing ? '⚙' : '!';
  elements.kicker.textContent = configMissing ? 'เว็บไซต์ยังไม่พร้อมใช้งาน' : 'ไม่พบข้อมูลคิว';
  elements.title.textContent = configMissing ? 'ยังไม่ได้ตั้งค่า Supabase' : 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว';
  elements.description.textContent = configMissing ? 'กรุณาให้ผู้ดูแลระบบตั้งค่าเว็บไซต์ก่อนเปิดใช้งาน' : 'ตรวจสอบ QR อีกครั้ง หรือติดต่อร้านเพื่อสอบถามสถานะ';
  elements.progress.innerHTML = renderProgress(-1, true);
  elements.basketList.innerHTML = '';
  elements.basketSummary.textContent = 'ไม่มีข้อมูล';
  elements.pickupLabel.textContent = 'สถานะคิว';
  elements.pickupTime.textContent = 'ตรวจสอบไม่ได้';
  elements.pickupNote.textContent = 'ไม่มีข้อมูลส่วนตัวถูกแสดง';
  elements.pickupCard.className = 'pickup-card danger';
}

async function fetchStatus({ announce = false } = {}) {
  const token = queueToken();
  const supabaseUrl = String(CONFIG.supabaseUrl || '').replace(/\/+$/, '');
  const publishableKey = String(CONFIG.publishableKey || '');
  if (!supabaseUrl || !publishableKey) {
    renderError('config');
    elements.notice.hidden = false;
    return;
  }
  elements.notice.hidden = true;
  if (token.length < 24) {
    renderError('not-found');
    return;
  }

  elements.refresh.disabled = true;
  elements.refresh.classList.add('loading');
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_public_queue_status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`
      },
      body: JSON.stringify({ p_token: token }),
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload) {
      renderError('not-found');
      return;
    }
    lastFetchedAt = new Date();
    render(payload);
    if (announce) showToast('อัปเดตข้อมูลล่าสุดแล้ว');
  } catch (error) {
    console.error('Queue status request failed:', error);
    if (!lastPayload) renderError('network');
    showToast('เชื่อมต่อข้อมูลไม่สำเร็จ กรุณาลองใหม่');
  } finally {
    elements.refresh.disabled = false;
    elements.refresh.classList.remove('loading');
  }
}

function updateLastSeen() {
  if (!lastFetchedAt) {
    elements.lastUpdate.textContent = 'ยังไม่ได้เชื่อมต่อ';
    return;
  }
  const seconds = Math.max(0, Math.floor((Date.now() - lastFetchedAt.getTime()) / 1000));
  elements.lastUpdate.textContent = seconds < 5 ? 'เมื่อสักครู่' : seconds < 60 ? `${seconds} วินาทีที่แล้ว` : `${Math.floor(seconds / 60)} นาทีที่แล้ว`;
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2600);
}

function configureActions() {
  const phone = String(CONFIG.phone || '').replace(/[^\d+]/g, '');
  if (phone) elements.phone.href = `tel:${phone}`;
  else elements.phone.hidden = true;
  if (CONFIG.mapUrl) elements.map.href = CONFIG.mapUrl;
  else elements.map.hidden = true;
}

elements.refresh.addEventListener('click', () => fetchStatus({ announce: true }));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) fetchStatus();
});

configureActions();
fetchStatus();
refreshTimer = setInterval(() => fetchStatus(), 30000);
setInterval(updateLastSeen, 1000);
window.addEventListener('beforeunload', () => clearInterval(refreshTimer));
