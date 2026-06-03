'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let collection = JSON.parse(localStorage.getItem('pokescan_collection') || '[]');
let alertLog = JSON.parse(localStorage.getItem('pokescan_alerts') || '[]');
let currentCard = null;
let sortMode = 'value'; // 'value' | 'name' | 'added'
let deferredInstallPrompt = null;

// Demo cards (αντικαθίσταται από Pokemon TCG API)
const DEMO_CARDS = [
  { id: 'xy1-1',  name: 'Venusaur EX',    set: 'XY · 001/146',              price: 12.50, change: +8.2,  trend: 'up',   cm: 'https://www.cardmarket.com/en/Pokemon/Cards/XY/Venusaur-EX' },
  { id: 'sv3-125',name: 'Charizard ex',   set: 'Obsidian Flames · 125/197', price: 28.50, change: +12.4, trend: 'up',   cm: 'https://www.cardmarket.com/en/Pokemon/Cards/Obsidian-Flames/Charizard-ex' },
  { id: 'swsh4-44',name:'Pikachu VMAX',   set: 'Vivid Voltage · 044/185',   price: 9.20,  change: -5.1,  trend: 'down', cm: 'https://www.cardmarket.com/en/Pokemon/Cards/Vivid-Voltage/Pikachu-VMAX' },
  { id: 'pgo-30', name: 'Mewtwo V',       set: 'Pokemon GO · 030/078',      price: 4.75,  change: +2.8,  trend: 'up',   cm: 'https://www.cardmarket.com/en/Pokemon/Cards/Pokemon-GO/Mewtwo-V' },
  { id: 'sv2-76', name: 'Gengar ex',      set: 'Paldea Evolved · 076/193',  price: 6.40,  change: -1.3,  trend: 'down', cm: 'https://www.cardmarket.com/en/Pokemon/Cards/Paldea-Evolved/Gengar-ex' },
];
let demoIdx = 0;

// ─── Service Worker ───────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('SW error:', err));
  });
}

// ─── PWA Install ──────────────────────────────────────────────────────────────
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById('installBtn').style.display = '';
});

function installPWA() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(r => {
    if (r.outcome === 'accepted') showToast('Εγκαταστάθηκε στην αρχική οθόνη!');
    deferredInstallPrompt = null;
    document.getElementById('installBtn').style.display = 'none';
  });
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function showTab(tab) {
  document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('nav-' + tab).classList.add('active');
  if (tab === 'collection') renderCollection();
  if (tab === 'alerts') renderAlerts();
  if (tab === 'settings') renderSettings();
}

// ─── Scan ──────────────────────────────────────────────────────────────────────
document.getElementById('fileInput').addEventListener('change', handleScan);

function handleScan(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  document.getElementById('resultWrap').classList.add('hidden');
  document.getElementById('loadingWrap').classList.remove('hidden');

  // Read image
  const reader = new FileReader();
  reader.onload = ev => {
    currentCard = { ...DEMO_CARDS[demoIdx % DEMO_CARDS.length], imgSrc: ev.target.result };
    demoIdx++;

    // Simulate API delay
    setTimeout(() => {
      document.getElementById('loadingWrap').classList.add('hidden');
      showResult(currentCard);
    }, 1800);
  };
  reader.readAsDataURL(file);
}

function showResult(card) {
  document.getElementById('resultImg').src = card.imgSrc;
  document.getElementById('resultName').textContent = card.name;
  document.getElementById('resultSet').textContent = card.set;
  document.getElementById('resultPrice').textContent = '€' + card.price.toFixed(2);

  const chEl = document.getElementById('resultChange');
  const sign = card.change > 0 ? '+' : '';
  chEl.textContent = sign + card.change.toFixed(1) + '%';
  chEl.className = 'result-change ' + (card.change > 0 ? 'up' : 'down');

  document.getElementById('resultWrap').classList.remove('hidden');
}

function addToCollection() {
  if (!currentCard) return;
  if (collection.find(c => c.id === currentCard.id)) {
    showToast(currentCard.name + ' υπάρχει ήδη στη συλλογή!');
    return;
  }
  collection.push({ ...currentCard, notify: true, addedAt: Date.now() });
  saveCollection();
  showToast('Προστέθηκε στη συλλογή!');
  showTab('collection');
}

function openCardMarket() {
  if (currentCard) window.open(currentCard.cm, '_blank');
}

// ─── Collection ───────────────────────────────────────────────────────────────
function renderCollection() {
  const sorted = [...collection].sort((a, b) => {
    if (sortMode === 'value') return b.price - a.price;
    if (sortMode === 'name') return a.name.localeCompare(b.name);
    return b.addedAt - a.addedAt;
  });

  document.getElementById('statCount').textContent = collection.length;
  const total = collection.reduce((s, c) => s + c.price, 0);
  document.getElementById('statValue').textContent = '€' + total.toFixed(2);

  const list = document.getElementById('collectionList');
  if (!collection.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">◈</div><p>Δεν έχεις κάρτες ακόμα</p><p class="empty-hint">Σκανάρισε την πρώτη σου!</p></div>`;
    return;
  }

  list.innerHTML = sorted.map((c, i) => {
    const realIdx = collection.indexOf(c);
    const imgHtml = c.imgSrc
      ? `<img class="coll-img" src="${c.imgSrc}" alt="${c.name}">`
      : `<div class="coll-img-placeholder">◈</div>`;
    return `
      <div class="coll-item">
        ${imgHtml}
        <div class="coll-info">
          <div class="coll-name">${c.name}</div>
          <div class="coll-set">${c.set.split('·')[0].trim()}</div>
        </div>
        <div class="coll-right">
          <div class="coll-price">€${c.price.toFixed(2)}</div>
          <div class="coll-change ${c.change > 0 ? 'up' : 'down'}">${c.change > 0 ? '+' : ''}${c.change.toFixed(1)}%</div>
          <div class="notif-toggle-wrap">
            <span class="notif-label">${c.notify ? 'alert on' : 'off'}</span>
            <div class="toggle-switch ${c.notify ? 'on' : ''}" onclick="toggleNotify(${realIdx})" role="switch" aria-checked="${c.notify}" aria-label="Ειδοποίηση για ${c.name}"></div>
          </div>
        </div>
      </div>`;
  }).join('');
}

function toggleNotify(i) {
  collection[i].notify = !collection[i].notify;
  saveCollection();
  renderCollection();
  if (document.getElementById('tab-settings').classList.contains('active')) renderSettings();
  updateAlertDot();
}

function toggleSort() {
  const modes = ['value', 'name', 'added'];
  const labels = { value: 'Αξία', name: 'Όνομα', added: 'Νέες' };
  sortMode = modes[(modes.indexOf(sortMode) + 1) % modes.length];
  document.getElementById('sortLabel').textContent = labels[sortMode];
  renderCollection();
}

// ─── Alerts ───────────────────────────────────────────────────────────────────
function renderAlerts() {
  document.getElementById('alertBadge') && (document.getElementById('alertBadge').textContent = alertLog.length);
  const list = document.getElementById('alertList');
  if (!alertLog.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">◈</div><p>Καμία ειδοποίηση ακόμα</p><p class="empty-hint">Ενεργοποίησε alerts στις ρυθμίσεις</p></div>`;
    return;
  }
  list.innerHTML = [...alertLog].reverse().map(a => `
    <div class="alert-item">
      <div class="alert-dot-icon ${a.dir}"></div>
      <div class="alert-body">
        <div class="alert-card-name">${a.name}</div>
        <div class="alert-detail">${a.dir === 'up' ? 'Άνοδος' : 'Πτώση'} ${Math.abs(a.pct).toFixed(1)}% → €${a.price.toFixed(2)}</div>
      </div>
      <div class="alert-time">${a.time}</div>
    </div>`).join('');
  updateAlertDot();
}

function clearAlerts() {
  alertLog = [];
  saveAlerts();
  renderAlerts();
  updateAlertDot();
}

function updateAlertDot() {
  const dot = document.getElementById('alertDot');
  const hasActive = collection.some(c => c.notify);
  dot.classList.toggle('hidden', !alertLog.length && !hasActive);
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function renderSettings() {
  const el = document.getElementById('cardNotifList');
  if (!collection.length) {
    el.innerHTML = '<p class="no-cards-msg">Δεν υπάρχουν κάρτες στη συλλογή ακόμα.</p>';
    return;
  }
  el.innerHTML = collection.map((c, i) => `
    <div class="card-notif-row">
      <div class="card-notif-name">${c.name}</div>
      <div class="card-notif-price">€${c.price.toFixed(2)}</div>
      <div class="toggle-switch ${c.notify ? 'on' : ''}" onclick="toggleNotify(${i})" role="switch" aria-checked="${c.notify}" aria-label="Ειδοποίηση ${c.name}"></div>
    </div>`).join('');
}

// ─── Price Refresh ────────────────────────────────────────────────────────────
function simulateRefresh() {
  if (!collection.length) { showToast('Δεν υπάρχουν κάρτες στη συλλογή!'); return; }
  const up = parseFloat(document.getElementById('threshUp').value) || 10;
  const dn = parseFloat(document.getElementById('threshDown').value) || 10;
  const now = new Date().toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' });
  let newAlerts = 0;

  collection.forEach(c => {
    const variation = (Math.random() * 30) - 12;
    const newPrice = Math.max(0.5, c.price * (1 + variation / 100));
    const pct = ((newPrice - c.price) / c.price) * 100;

    if (c.notify && pct >= up) {
      alertLog.push({ name: c.name, dir: 'up', pct, price: parseFloat(newPrice.toFixed(2)), time: now });
      c.price = parseFloat(newPrice.toFixed(2));
      c.change = parseFloat(pct.toFixed(1));
      newAlerts++;
      sendPushNotification(c.name, `Άνοδος +${pct.toFixed(1)}% → €${newPrice.toFixed(2)}`);
    } else if (c.notify && pct <= -dn) {
      alertLog.push({ name: c.name, dir: 'down', pct, price: parseFloat(newPrice.toFixed(2)), time: now });
      c.price = parseFloat(newPrice.toFixed(2));
      c.change = parseFloat(pct.toFixed(1));
      newAlerts++;
      sendPushNotification(c.name, `Πτώση ${pct.toFixed(1)}% → €${newPrice.toFixed(2)}`);
    }
  });

  saveCollection();
  saveAlerts();
  renderCollection();
  renderAlerts();
  updateAlertDot();
  showToast(newAlerts > 0 ? `${newAlerts} νέα alert${newAlerts > 1 ? 's' : ''}!` : 'Τιμές ανανεώθηκαν — καμία αλλαγή');
}

// ─── Push Notifications ───────────────────────────────────────────────────────
async function requestNotifPermission() {
  if (!('Notification' in window)) {
    document.getElementById('notifStatus').textContent = 'Ο browser δεν υποστηρίζει notifications.';
    return;
  }
  const perm = await Notification.requestPermission();
  const status = document.getElementById('notifStatus');
  const btn = document.getElementById('notifBtn');
  if (perm === 'granted') {
    status.textContent = '✓ Ειδοποιήσεις ενεργοποιημένες!';
    btn.textContent = 'Ενεργοποιημένες ✓';
    btn.disabled = true;
    showToast('Push notifications ενεργά!');
  } else {
    status.textContent = 'Απορρίφθηκαν. Ενεργοποίησε τες από τις ρυθμίσεις browser.';
  }
}

function sendPushNotification(title, body) {
  if (Notification.permission === 'granted') {
    new Notification('PokéScan — ' + title, {
      body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
    });
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────────
function saveCollection() { localStorage.setItem('pokescan_collection', JSON.stringify(collection)); }
function saveAlerts() { localStorage.setItem('pokescan_alerts', JSON.stringify(alertLog)); }

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  clearTimeout(toastTimer);
  requestAnimationFrame(() => {
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  });
}

// ─── Notification permission check on load ────────────────────────────────────
window.addEventListener('load', () => {
  if (Notification.permission === 'granted') {
    const btn = document.getElementById('notifBtn');
    if (btn) { btn.textContent = 'Ενεργοποιημένες ✓'; btn.disabled = true; }
    document.getElementById('notifStatus').textContent = '✓ Ειδοποιήσεις ενεργοποιημένες!';
  }
  updateAlertDot();
});
