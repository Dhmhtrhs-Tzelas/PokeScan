'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let collection = JSON.parse(localStorage.getItem('pokescan_collection') || '[]');
let alertLog = JSON.parse(localStorage.getItem('pokescan_alerts') || '[]');
let currentCard = null;
let sortMode = 'value';
let deferredInstallPrompt = null;

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

// ─── Scan ─────────────────────────────────────────────────────────────────────
document.getElementById('fileInput').addEventListener('change', handleScan);

function handleScan(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  document.getElementById('resultWrap').classList.add('hidden');
  document.getElementById('loadingWrap').classList.remove('hidden');
  document.querySelector('.loading-text').textContent = 'Αναγνώριση κάρτας με AI...';

  const reader = new FileReader();
  reader.onload = async (ev) => {
    const imageBase64 = ev.target.result;
    try {
      const res = await fetch('/api/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64 })
      });

      const card = await res.json();

      if (!res.ok || card.error) {
        document.getElementById('loadingWrap').classList.add('hidden');
        showToast('❌ ' + (card.error || 'Σφάλμα αναγνώρισης'));
        return;
      }

      currentCard = {
        id: card.tcgId || card.name + '-' + Date.now(),
        name: card.name,
        set: card.set + (card.number ? ' · ' + card.number : ''),
        price: card.price || 0,
        change: 0,
        trend: 'up',
        cm: card.cardmarketUrl,
        imgSrc: card.image || imageBase64,
        rarity: card.rarity,
        type: card.type,
        priceSource: card.priceSource,
      };

      document.getElementById('loadingWrap').classList.add('hidden');
      showResult(currentCard);

    } catch (err) {
      document.getElementById('loadingWrap').classList.add('hidden');
      showToast('❌ Σφάλμα σύνδεσης: ' + err.message);
    }
  };
  reader.readAsDataURL(file);
}

function showResult(card) {
  document.getElementById('resultImg').src = card.imgSrc;
  document.getElementById('resultName').textContent = card.name;
  document.getElementById('resultSet').textContent = card.set;

  if (card.price && card.price > 0) {
    document.getElementById('resultPrice').textContent = '€' + card.price.toFixed(2);
  } else {
    document.getElementById('resultPrice').textContent = 'Τιμή N/A';
  }

  const chEl = document.getElementById('resultChange');
  if (card.priceSource) {
    chEl.textContent = card.priceSource;
    chEl.className = 'result-change up';
  } else {
    chEl.textContent = card.rarity || '';
    chEl.className = 'result-change up';
  }

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
  showToast('✓ Προστέθηκε στη συλλογή!');
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
  const total = collection.reduce((s, c) => s + (c.price || 0), 0);
  document.getElementById('statValue').textContent = '€' + total.toFixed(2);

  const list = document.getElementById('collectionList');
  if (!collection.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">◈</div><p>Δεν έχεις κάρτες ακόμα</p><p class="empty-hint">Σκανάρισε την πρώτη σου!</p></div>`;
    return;
  }

  list.innerHTML = sorted.map((c) => {
    const realIdx = collection.indexOf(c);
    const imgHtml = c.imgSrc
      ? `<img class="coll-img" src="${c.imgSrc}" alt="${c.name}">`
      : `<div class="coll-img-placeholder">◈</div>`;
    const priceStr = c.price > 0 ? '€' + c.price.toFixed(2) : 'N/A';
    const changeStr = c.change !== 0 ? (c.change > 0 ? '+' : '') + c.change.toFixed(1) + '%' : c.rarity || '';
    return `
      <div class="coll-item">
        ${imgHtml}
        <div class="coll-info">
          <div class="coll-name">${c.name}</div>
          <div class="coll-set">${c.set.split('·')[0].trim()}</div>
        </div>
        <div class="coll-right">
          <div class="coll-price">${priceStr}</div>
          <div class="coll-change ${c.change >= 0 ? 'up' : 'down'}">${changeStr}</div>
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
  dot.classList.toggle('hidden', !alertLog.length);
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
      <div class="card-notif-price">${c.price > 0 ? '€' + c.price.toFixed(2) : 'N/A'}</div>
      <div class="toggle-switch ${c.notify ? 'on' : ''}" onclick="toggleNotify(${i})" role="switch" aria-checked="${c.notify}" aria-label="Ειδοποίηση ${c.name}"></div>
    </div>`).join('');
}

// ─── Price Refresh ────────────────────────────────────────────────────────────
async function simulateRefresh() {
  if (!collection.length) { showToast('Δεν υπάρχουν κάρτες στη συλλογή!'); return; }
  const up = parseFloat(document.getElementById('threshUp').value) || 10;
  const dn = parseFloat(document.getElementById('threshDown').value) || 10;
  const now = new Date().toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' });

  showToast('Ανανέωση τιμών...');
  let newAlerts = 0;

  for (const c of collection) {
    if (!c.notify || !c.id) continue;
    try {
      const tcgRes = await fetch(`https://api.pokemontcg.io/v2/cards/${c.id}`);
      if (!tcgRes.ok) continue;
      const tcgData = await tcgRes.json();
      const card = tcgData.data;
      let newPrice = null;
      if (card?.cardmarket?.prices?.averageSellPrice) newPrice = card.cardmarket.prices.averageSellPrice;
      else if (card?.tcgplayer?.prices) {
        const p = card.tcgplayer.prices;
        const pk = p.holofoil || p.normal || p.reverseHolofoil;
        if (pk?.market) newPrice = pk.market;
      }
      if (!newPrice || !c.price) continue;
      const pct = ((newPrice - c.price) / c.price) * 100;
      if (pct >= up) {
        alertLog.push({ name: c.name, dir: 'up', pct, price: parseFloat(newPrice.toFixed(2)), time: now });
        c.price = parseFloat(newPrice.toFixed(2));
        c.change = parseFloat(pct.toFixed(1));
        newAlerts++;
        sendPushNotification(c.name, `Άνοδος +${pct.toFixed(1)}% → €${newPrice.toFixed(2)}`);
      } else if (pct <= -dn) {
        alertLog.push({ name: c.name, dir: 'down', pct, price: parseFloat(newPrice.toFixed(2)), time: now });
        c.price = parseFloat(newPrice.toFixed(2));
        c.change = parseFloat(pct.toFixed(1));
        newAlerts++;
        sendPushNotification(c.name, `Πτώση ${pct.toFixed(1)}% → €${newPrice.toFixed(2)}`);
      }
    } catch (err) { console.log('Price refresh error:', err); }
  }

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
    new Notification('PokéScan — ' + title, { body, icon: 'icons/icon-192.png' });
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

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  if (Notification.permission === 'granted') {
    const btn = document.getElementById('notifBtn');
    if (btn) { btn.textContent = 'Ενεργοποιημένες ✓'; btn.disabled = true; }
    document.getElementById('notifStatus').textContent = '✓ Ειδοποιήσεις ενεργοποιημένες!';
  }
  updateAlertDot();
});
