'use strict';

let collection = JSON.parse(localStorage.getItem('pokescan_collection') || '[]');
let alertLog = JSON.parse(localStorage.getItem('pokescan_alerts') || '[]');
let currentCard = null;
let sortMode = 'value';
let deferredInstallPrompt = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredInstallPrompt = e;
  document.getElementById('installBtn').style.display = '';
});

function installPWA() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(() => { deferredInstallPrompt = null; document.getElementById('installBtn').style.display = 'none'; });
}

function showTab(tab) {
  document.querySelectorAll('.tab').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('nav-' + tab).classList.add('active');
  if (tab === 'collection') renderCollection();
  if (tab === 'alerts') renderAlerts();
  if (tab === 'settings') renderSettings();
}

window.addEventListener('load', () => {
  document.getElementById('searchName').addEventListener('keypress', e => { if (e.key === 'Enter') searchCard(); });
  document.getElementById('searchNumber').addEventListener('keypress', e => { if (e.key === 'Enter') searchCard(); });
  checkNotifPermission();
  updateBadge();
  renderCollection();
  renderAlerts();
});

async function searchCard() {
  const name = document.getElementById('searchName').value.trim();
  const number = document.getElementById('searchNumber').value.trim();
  if (!name) { showToast('⚠️ Βάλε όνομα κάρτας!'); return; }

  const btn = document.getElementById('searchBtn');
  btn.disabled = true;
  document.getElementById('resultWrap').classList.add('hidden');
  document.getElementById('tipsSection').style.display = 'none';
  document.getElementById('loadingWrap').classList.remove('hidden');

  try {
    const res = await fetch('/api/recognize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, number })
    });
    const card = await res.json();
    document.getElementById('loadingWrap').classList.add('hidden');

    if (!res.ok || card.error) {
      showToast('❌ ' + (card.error || 'Δεν βρέθηκε κάρτα'));
      document.getElementById('tipsSection').style.display = '';
      return;
    }

    currentCard = { ...card, id: card.tcgId || name + '-' + Date.now() };
    showResult(card);
  } catch (err) {
    document.getElementById('loadingWrap').classList.add('hidden');
    document.getElementById('tipsSection').style.display = '';
    showToast('❌ Σφάλμα σύνδεσης');
  } finally {
    btn.disabled = false;
  }
}

function showResult(card) {
  const img = document.getElementById('resultImg');
  if (card.image) { img.src = card.image; img.style.display = ''; }
  else img.style.display = 'none';
  document.getElementById('resultName').textContent = card.name;
  document.getElementById('resultSet').textContent = card.set || '—';
  document.getElementById('resultRarity').textContent = card.rarity || '—';
  document.getElementById('resultPrice').textContent = card.price ? '€' + card.price.toFixed(2) : 'N/A';
  document.getElementById('resultSource').textContent = card.priceSource || '—';
  document.getElementById('resultWrap').classList.remove('hidden');
}

function addToCollection() {
  if (!currentCard) return;
  if (collection.find(c => c.id === currentCard.id)) { showToast('Υπάρχει ήδη στη συλλογή!'); return; }
  collection.push({ ...currentCard, notify: true, addedAt: Date.now(), change: 0 });
  saveCollection();
  showToast('✅ Προστέθηκε στη συλλογή!');
  showTab('collection');
}

function openCM() { if (currentCard?.cardmarketUrl) window.open(currentCard.cardmarketUrl, '_blank'); }

function editPrice(i) {
  const c = collection[i];
  const current = c.price ? c.price.toFixed(2) : '';
  const newPrice = prompt(`Τιμή για "${c.name}" (€):`, current);
  if (newPrice === null) return;
  const parsed = parseFloat(newPrice.replace(',', '.'));
  if (isNaN(parsed) || parsed < 0) { showToast('❌ Μη έγκυρη τιμή!'); return; }
  collection[i].price = parsed;
  collection[i].priceSource = 'Χειροκίνητη';
  saveCollection();
  renderCollection();
  showToast('✅ Τιμή ενημερώθηκε!');
}

function renderCollection() {
  const sorted = [...collection].sort((a, b) => {
    if (sortMode === 'value') return (b.price || 0) - (a.price || 0);
    if (sortMode === 'name') return a.name.localeCompare(b.name);
    return b.addedAt - a.addedAt;
  });
  document.getElementById('statCount').textContent = collection.length;
  document.getElementById('statValue').textContent = '€' + collection.reduce((s, c) => s + (c.price || 0), 0).toFixed(2);
  const list = document.getElementById('collectionList');
  if (!collection.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-ball"><svg viewBox="0 0 60 60" width="60" height="60"><circle cx="30" cy="30" r="28" fill="#ddd" stroke="#bbb" stroke-width="2"/><rect x="2" y="28" width="56" height="4" fill="#999"/><path d="M2 30 Q30 2 58 30" fill="#ddd"/><path d="M2 30 Q30 58 58 30" fill="#f5f5f5"/><circle cx="30" cy="30" r="9" fill="white" stroke="#bbb" stroke-width="2"/></svg></div><p>Δεν έχεις κάρτες ακόμα!</p><p class="empty-sub">Αναζήτησε μια κάρτα και πρόσθεσέ τη</p></div>`;
    return;
  }
  list.innerHTML = sorted.map(c => {
    const i = collection.indexOf(c);
    const priceDisplay = c.price ? '€' + c.price.toFixed(2) : 'N/A';
    const priceColor = !c.price ? 'color:#f87171' : '';
    return `<div class="coll-item">
      <div class="coll-img-wrap">${c.image ? `<img src="${c.image}" alt="${c.name}">` : '🃏'}</div>
      <div class="coll-info">
        <div class="coll-name">${c.name}</div>
        <div class="coll-set">${(c.set || '').split('·')[0].trim()}</div>
      </div>
      <div class="coll-right">
        <div class="coll-price-row" style="display:flex;align-items:center;gap:4px;justify-content:flex-end">
          <div class="coll-price" style="${priceColor}">${priceDisplay}</div>
          <button onclick="editPrice(${i})" style="background:none;border:none;cursor:pointer;font-size:14px;padding:0 2px;opacity:0.7" title="Επεξεργασία τιμής">✏️</button>
        </div>
        <div class="coll-change ${c.change >= 0 ? 'up' : 'down'}">${c.change !== 0 ? (c.change > 0 ? '+' : '') + c.change.toFixed(1) + '%' : c.rarity || ''}</div>
        <div class="notif-wrap"><span>${c.notify ? 'on' : 'off'}</span><div class="toggle ${c.notify ? 'on' : ''}" onclick="toggleNotify(${i})"></div></div>
      </div>
    </div>`;
  }).join('');
}

function toggleNotify(i) {
  collection[i].notify = !collection[i].notify;
  saveCollection(); renderCollection();
  if (document.getElementById('tab-settings').classList.contains('active')) renderSettings();
}

function toggleSort() {
  const modes = ['value', 'name', 'added'];
  const labels = { value: 'Αξία', name: 'Όνομα', added: 'Νέες' };
  sortMode = modes[(modes.indexOf(sortMode) + 1) % modes.length];
  document.getElementById('sortLabel').textContent = labels[sortMode];
  renderCollection();
}

function renderAlerts() {
  const list = document.getElementById('alertList');
  if (!alertLog.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-ball"><svg viewBox="0 0 60 60" width="60" height="60"><circle cx="30" cy="30" r="28" fill="#ddd" stroke="#bbb" stroke-width="2"/><rect x="2" y="28" width="56" height="4" fill="#999"/><path d="M2 30 Q30 2 58 30" fill="#ddd"/><path d="M2 30 Q30 58 58 30" fill="#f5f5f5"/><circle cx="30" cy="30" r="9" fill="white" stroke="#bbb" stroke-width="2"/></svg></div><p>Καμία ειδοποίηση ακόμα</p><p class="empty-sub">Θα εμφανιστούν όταν αλλάξουν οι τιμές</p></div>`;
    return;
  }
  list.innerHTML = [...alertLog].reverse().map(a => `
    <div class="alert-item">
      <div class="alert-dot ${a.dir}"></div>
      <div class="alert-body">
        <div class="alert-name">${a.name}</div>
        <div class="alert-detail">${a.dir === 'up' ? '📈 Άνοδος' : '📉 Πτώση'} ${Math.abs(a.pct).toFixed(1)}% → €${a.price.toFixed(2)}</div>
      </div>
      <div class="alert-time">${a.time}</div>
    </div>`).join('');
  updateBadge();
}

function clearAlerts() { alertLog = []; saveAlerts(); renderAlerts(); updateBadge(); showToast('Καθαρίστηκαν οι ειδοποιήσεις'); }

function updateBadge() {
  const badge = document.getElementById('notifBadge');
  if (alertLog.length > 0) { badge.textContent = alertLog.length; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');
}

function renderSettings() {
  const el = document.getElementById('cardNotifList');
  if (!collection.length) { el.innerHTML = '<p class="no-cards">Δεν υπάρχουν κάρτες ακόμα.</p>'; return; }
  el.innerHTML = collection.map((c, i) => `
    <div class="card-notif-row">
      <div class="card-notif-name">${c.name}</div>
      <div class="card-notif-price" style="cursor:pointer" onclick="editPrice(${i})" title="Πάτα για αλλαγή τιμής">${c.price ? '€' + c.price.toFixed(2) : 'N/A ✏️'}</div>
      <div class="toggle ${c.notify ? 'on' : ''}" onclick="toggleNotify(${i})"></div>
    </div>`).join('');
}

async function refreshPrices() {
  if (!collection.length) { showToast('Δεν υπάρχουν κάρτες!'); return; }
  const up = parseFloat(document.getElementById('threshUp').value) || 10;
  const dn = parseFloat(document.getElementById('threshDown').value) || 10;
  const now = new Date().toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' });
  showToast('🔄 Ανανέωση τιμών...');
  let newAlerts = 0;

  for (const c of collection) {
    if (!c.tcgId || !c.price) continue;
    try {
      const res = await fetch(`https://api.pokemontcg.io/v2/cards/${c.tcgId}`);
      if (!res.ok) continue;
      const data = await res.json();
      const card = data.data;
      let newPrice = null;
      if (card?.cardmarket?.prices?.averageSellPrice) newPrice = card.cardmarket.prices.averageSellPrice;
      else if (card?.cardmarket?.prices?.trendPrice) newPrice = card.cardmarket.prices.trendPrice;
      else if (card?.tcgplayer?.prices) {
        const pk = card.tcgplayer.prices.holofoil || card.tcgplayer.prices.normal || card.tcgplayer.prices.unlimited;
        if (pk?.market) newPrice = pk.market;
        else if (pk?.mid) newPrice = pk.mid;
      }
      if (!newPrice) continue;
      const pct = ((newPrice - c.price) / c.price) * 100;
      if (c.notify && pct >= up) {
        alertLog.push({ name: c.name, dir: 'up', pct, price: parseFloat(newPrice.toFixed(2)), time: now });
        c.price = parseFloat(newPrice.toFixed(2)); c.change = parseFloat(pct.toFixed(1)); newAlerts++;
        sendPush(c.name, `📈 Άνοδος +${pct.toFixed(1)}% → €${newPrice.toFixed(2)}`);
      } else if (c.notify && pct <= -dn) {
        alertLog.push({ name: c.name, dir: 'down', pct, price: parseFloat(newPrice.toFixed(2)), time: now });
        c.price = parseFloat(newPrice.toFixed(2)); c.change = parseFloat(pct.toFixed(1)); newAlerts++;
        sendPush(c.name, `📉 Πτώση ${pct.toFixed(1)}% → €${newPrice.toFixed(2)}`);
      }
    } catch (e) {}
  }
  saveCollection(); saveAlerts(); renderCollection(); updateBadge();
  showToast(newAlerts > 0 ? `🔔 ${newAlerts} νέα alert${newAlerts > 1 ? 's' : ''}!` : '✅ Καμία αλλαγή τιμής');
}

async function requestNotifPermission() {
  if (!('Notification' in window)) { document.getElementById('notifStatus').textContent = 'Δεν υποστηρίζεται.'; return; }
  const p = await Notification.requestPermission();
  if (p === 'granted') {
    document.getElementById('notifStatus').textContent = '✅ Ενεργοποιημένες!';
    document.getElementById('notifBtn').textContent = 'Ενεργοποιημένες ✓';
    document.getElementById('notifBtn').disabled = true;
  } else {
    document.getElementById('notifStatus').textContent = 'Απορρίφθηκαν από τις ρυθμίσεις browser.';
  }
}

function checkNotifPermission() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const btn = document.getElementById('notifBtn');
    if (btn) { btn.textContent = 'Ενεργοποιημένες ✓'; btn.disabled = true; }
    document.getElementById('notifStatus').textContent = '✅ Ενεργοποιημένες!';
  }
}

function sendPush(title, body) {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification('PokéScan — ' + title, { body, icon: 'icons/icon-192.png' });
  }
}

function saveCollection() { localStorage.setItem('pokescan_collection', JSON.stringify(collection)); }
function saveAlerts() { localStorage.setItem('pokescan_alerts', JSON.stringify(alertLog)); }

let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.classList.remove('hidden'); t.textContent = msg;
  clearTimeout(toastTimer);
  requestAnimationFrame(() => {
    t.classList.add('show');
    toastTimer = setTimeout(() => { t.classList.remove('show'); }, 2800);
  });
}
