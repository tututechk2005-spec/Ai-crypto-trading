/* ══════════════════════════════════════════
   CORE APP — Navigation, Auth, Notifications
   ══════════════════════════════════════════ */
const API = '';
let token = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');
let socket = null;
let currentPage = 'home';

// ── Auth guard ────────────────────────────────────────────────────────────────
function requireAuth() {
  if (!token) { window.location.href = 'login.html'; return false; }
  return true;
}
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = 'login.html';
}

// ── API helper ────────────────────────────────────────────────────────────────
async function apiGet(path) {
  const res = await fetch(API + path, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 401) { logout(); return null; }
  return res.json();
}
async function apiPost(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body)
  });
  if (res.status === 401) { logout(); return null; }
  return res.json();
}
async function apiPut(path, body) {
  const res = await fetch(API + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body)
  });
  return res.json();
}
async function apiDelete(path) {
  const res = await fetch(API + path, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token }
  });
  return res.json();
}

// ── Format helpers ────────────────────────────────────────────────────────────
function fmt(n, dec = 2) {
  if (n === null || n === undefined) return '—';
  return parseFloat(n).toFixed(dec);
}
function fmtPrice(n) {
  const p = parseFloat(n);
  if (isNaN(p)) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(8);
}
function fmtVol(n) {
  const v = parseFloat(n);
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return v.toFixed(2);
}
function fmtPnl(n) {
  const v = parseFloat(n) || 0;
  return (v >= 0 ? '+' : '') + '$' + Math.abs(v).toFixed(2);
}
function pnlClass(n) { return parseFloat(n) >= 0 ? 'text-green' : 'text-red'; }
function timeAgo(iso) {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60000) return Math.floor(d / 1000) + 's ago';
  if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
  if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
  return Math.floor(d / 86400000) + 'd ago';
}
function duration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'm';
  return Math.floor(h / 24) + 'd';
}

// ── Notifications ─────────────────────────────────────────────────────────────
const notifContainer = document.getElementById('notification-container');
const shownNotifs = new Set();

function notify(title, msg, type = 'info', persistent = false) {
  const key = title + msg;
  if (shownNotifs.has(key)) return;
  shownNotifs.add(key);
  setTimeout(() => shownNotifs.delete(key), 5000);

  const el = document.createElement('div');
  el.className = `notification ${type}`;
  el.innerHTML = `<div class="notification-title">${title}</div><div class="notification-msg">${msg}</div>`;
  notifContainer.appendChild(el);
  el.addEventListener('click', () => el.remove());
  if (!persistent) setTimeout(() => { el.style.animation = 'slideOut 0.3s forwards'; setTimeout(() => el.remove(), 300); }, 4000);
  return el;
}

// ── Navigation ────────────────────────────────────────────────────────────────
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');
  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');
  currentPage = page;
  loadPage(page);
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => navigate(item.dataset.page));
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
function connectSocket() {
  if (!window.io) return;
  socket = io({ auth: { token } });

  socket.on('connect', () => console.log('[Socket] Connected'));
  socket.on('newSignal', (sig) => {
    notify(`🎯 Signal: ${sig.symbol}`, `${sig.direction} | Score: ${sig.score} | RR: ${sig.rr}`, 'info');
    if (currentPage === 'signals') loadSignals();
  });
  socket.on('tradeClosed', (data) => {
    notify('Trade Closed', `PNL: ${fmtPnl(data.pnl)} (${data.reason})`, parseFloat(data.pnl) >= 0 ? 'success' : 'danger');
    if (currentPage === 'trades') loadTrades();
  });
  socket.on('tradeOpened', () => { if (currentPage === 'trades') loadTrades(); });
  socket.on('marketTickers', (tickers) => {
    if (currentPage === 'market') updateMarketTable(tickers);
    updateLivePrices(tickers);
  });
  socket.on('recentSignals', (signals) => { window._latestSignals = signals; });
  socket.on('accountSynced', (data) => {
    if (data.success) {
      notify('Account Synced', 'Balance and positions updated', 'success');
      if (currentPage === 'home') loadDashboard();
    } else {
      notify('Sync Failed', data.error, 'danger');
    }
  });

  // Subscribe to market on market page
  socket.emit('subscribeMarket');
}

// ── Live price updates in open trades ────────────────────────────────────────
function updateLivePrices(tickers) {
  const priceMap = {};
  (tickers || []).forEach(t => { priceMap[t.symbol] = parseFloat(t.lastPrice); });
  document.querySelectorAll('[data-trade-symbol]').forEach(row => {
    const sym = row.dataset.tradeSymbol;
    const price = priceMap[sym];
    if (!price) return;
    const priceEl = row.querySelector('.live-price');
    if (priceEl) priceEl.textContent = fmtPrice(price);
    const entry = parseFloat(row.dataset.entry || 0);
    const qty = parseFloat(row.dataset.qty || 0);
    const lev = parseFloat(row.dataset.lev || 1);
    const dir = row.dataset.dir;
    if (entry && qty) {
      const diff = (dir === 'BUY' || dir === 'LONG') ? price - entry : entry - price;
      const pnl = diff * qty * lev;
      const roi = entry > 0 ? (diff / entry) * 100 * lev : 0;
      const pnlEl = row.querySelector('.live-pnl');
      const roiEl = row.querySelector('.live-roi');
      if (pnlEl) { pnlEl.textContent = fmtPnl(pnl); pnlEl.className = 'live-pnl pnl-value ' + pnlClass(pnl); }
      if (roiEl) { roiEl.textContent = (roi >= 0 ? '+' : '') + roi.toFixed(2) + '%'; roiEl.className = 'live-roi ' + pnlClass(roi); }
    }
  });
}

// ── Modal helper ──────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); });
});

// ── Copy to clipboard ─────────────────────────────────────────────────────────
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => notify('Copied!', text, 'info'));
}

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth()) return;

  // Refresh user profile
  try {
    const me = await apiGet('/api/auth/me');
    if (me) { currentUser = me; localStorage.setItem('user', JSON.stringify(me)); }
  } catch { }

  updateUserUI();
  connectSocket();
  navigate('home');
});

function updateUserUI() {
  if (!currentUser) return;
  const modeEl = document.getElementById('modeBadge');
  if (modeEl) {
    modeEl.textContent = currentUser.tradeMode === 'real' ? 'REAL' : 'DEMO';
    modeEl.className = `mode-badge ${currentUser.tradeMode === 'real' ? 'real' : 'demo'}`;
  }
}

// ── Page loaders ──────────────────────────────────────────────────────────────
function loadPage(page) {
  switch (page) {
    case 'home': loadDashboard(); break;
    case 'signals': loadSignals(); break;
    case 'trades': loadTrades(); break;
    case 'earnings': loadEarnings(); break;
    case 'market': loadMarket(); break;
    case 'assets': loadAssets(); break;
    case 'strategy': loadStrategy(); break;
    case 'api': loadAPIBind(); break;
    case 'invite': loadReferral(); break;
    case 'profile': loadProfile(); break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HOME / DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
async function loadDashboard() {
  const [stats, trades, signals] = await Promise.all([
    apiGet('/api/stats'),
    apiGet('/api/trades?status=open'),
    apiGet('/api/signals?limit=3'),
  ]);

  const snap = currentUser?.accountSnapshot || {};
  const s = stats || {};

  document.getElementById('dash-balance').textContent = '$' + fmt(snap.balance || 0);
  document.getElementById('dash-avail').textContent = '$' + fmt(snap.availableBalance || 0);
  document.getElementById('dash-lifetime').textContent = '$' + fmt(s.lifetimeProfit || 0);
  document.getElementById('dash-today').textContent = '$' + fmt(s.todayProfit || 0);
  document.getElementById('dash-winrate').textContent = (s.winRate || 0) + '%';
  document.getElementById('dash-total-trades').textContent = s.totalTrades || 0;
  document.getElementById('dash-open-trades').textContent = (trades || []).length;
  document.getElementById('dash-closed-trades').textContent = s.totalTrades - (s.winTrades + s.lossTrades) >= 0 ? s.totalTrades : 0;
  document.getElementById('dash-today-trades').textContent = '—';
  document.getElementById('dash-recovery').innerHTML = s.recoveryMode
    ? '<span class="recovery-badge">RECOVERY MODE</span>' : '<span style="color:var(--green)">Normal</span>';
  document.getElementById('dash-strategy').textContent = 'Smart Money Concept';

  // Win/loss bar
  const total = (s.winTrades || 0) + (s.lossTrades || 0);
  const winPct = total > 0 ? (s.winTrades / total) * 100 : 50;
  const bar = document.getElementById('winloss-bar');
  if (bar) bar.innerHTML = `
    <div class="win-fill" style="width:${winPct}%"></div>
    <div class="loss-fill" style="width:${100 - winPct}%"></div>
  `;

  // Recent signals
  const sigContainer = document.getElementById('dash-signals');
  if (sigContainer && signals) {
    sigContainer.innerHTML = signals.slice(0, 3).map(renderSignalMini).join('') || '<div class="empty-state"><p>No signals yet</p></div>';
  }
}

function renderSignalMini(s) {
  const dir = s.direction === 'BUY' ? 'buy' : 'sell';
  return `<div class="signal-card ${dir}" style="margin-bottom:8px">
    <div class="signal-header">
      <span class="signal-symbol">${s.symbol}</span>
      <span class="signal-dir ${dir}">${s.direction}</span>
    </div>
    <div class="signal-grid">
      <div class="signal-item"><label>Entry</label><span>${fmtPrice(s.entry)}</span></div>
      <div class="signal-item"><label>Score</label><span class="text-accent">${s.score}</span></div>
      <div class="signal-item"><label>RR</label><span class="text-green">1:${fmt(s.rr)}</span></div>
    </div>
    <div style="font-size:11px;color:var(--text3)">${timeAgo(s.generatedAt)}</div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNALS
// ─────────────────────────────────────────────────────────────────────────────
async function loadSignals() {
  const cont = document.getElementById('signals-list');
  cont.innerHTML = '<div class="loading"><div class="spinner"></div> Scanning market...</div>';
  const signals = await apiGet('/api/signals?limit=50');
  if (!signals || signals.length === 0) {
    cont.innerHTML = '<div class="empty-state"><div class="empty-icon">📡</div><p>No high-confidence signals yet.<br>Scanner runs every minute.</p></div>';
    return;
  }
  cont.innerHTML = signals.map(renderSignalCard).join('');
  document.getElementById('signals-count').textContent = signals.length;
}

function renderSignalCard(s) {
  const dir = s.direction === 'BUY' ? 'buy' : 'sell';
  const checks = (s.confirmations || []).map(c => `<span class="check-item">${c}</span>`).join('');
  return `<div class="signal-card ${dir}">
    <div class="signal-header">
      <div>
        <div class="signal-symbol">${s.symbol}</div>
        <div style="font-size:11px;color:var(--text3)">${s.marketType || 'FUTURES'} · ${timeAgo(s.generatedAt)}</div>
      </div>
      <div style="text-align:right">
        <span class="signal-dir ${dir}">${s.direction}</span>
        <div style="font-size:11px;color:var(--text3);margin-top:4px">Score: <span class="text-accent fw-700">${s.score}</span></div>
      </div>
    </div>
    <div class="signal-grid">
      <div class="signal-item"><label>Entry</label><span>${fmtPrice(s.entry)}</span></div>
      <div class="signal-item"><label>Stop Loss</label><span class="text-red">${fmtPrice(s.sl)}</span></div>
      <div class="signal-item"><label>Take Profit</label><span class="text-green">${fmtPrice(s.tp)}</span></div>
      <div class="signal-item"><label>RR</label><span class="text-green">1:${fmt(s.rr)}</span></div>
      <div class="signal-item"><label>4H Trend</label><span>${s.trend4h || '—'}</span></div>
      <div class="signal-item"><label>1H Trend</label><span>${s.trend1h || '—'}</span></div>
    </div>
    <div class="signal-score">
      <span style="font-size:11px;color:var(--text3)">Confidence</span>
      <div class="score-bar"><div class="score-fill" style="width:${s.score}%"></div></div>
      <span style="font-size:13px;font-weight:700;color:var(--accent)">${s.score}%</span>
    </div>
    ${checks ? `<div class="checklist">${checks}</div>` : ''}
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRADES
// ─────────────────────────────────────────────────────────────────────────────
let tradeTab = 'open';

async function loadTrades() {
  const cont = document.getElementById('trades-list');
  cont.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const trades = await apiGet(`/api/trades?status=${tradeTab}`);
  if (!trades || trades.length === 0) {
    cont.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><p>No ${tradeTab} trades</p></div>`;
    return;
  }
  cont.innerHTML = trades.map(t => tradeTab === 'open' ? renderOpenTrade(t) : renderClosedTrade(t)).join('');
}

function renderOpenTrade(t) {
  const dir = (t.direction || '').toLowerCase();
  const durMs = Date.now() - new Date(t.openedAt).getTime();
  return `<div class="trade-card" data-trade-symbol="${t.symbol}" data-entry="${t.entry}" data-qty="${t.quantity}" data-lev="${t.leverage || 1}" data-dir="${t.direction}">
    <div class="trade-header">
      <div class="trade-symbol-row">
        <span class="fw-700">${t.symbol}</span>
        <span class="trade-dir-badge ${dir}">${t.direction}</span>
        ${t.leverage > 1 ? `<span style="font-size:10px;color:var(--orange)">${t.leverage}x</span>` : ''}
      </div>
      <div class="trade-pnl">
        <div class="live-pnl pnl-value ${pnlClass(t.pnl)}">${fmtPnl(t.pnl)}</div>
        <div class="live-roi text-sm ${pnlClass(t.roi)}">${(parseFloat(t.roi) >= 0 ? '+' : '') + fmt(t.roi)}%</div>
      </div>
    </div>
    <div class="trade-info-grid">
      <div class="trade-info-item"><label>Entry</label><span>${fmtPrice(t.entry)}</span></div>
      <div class="trade-info-item"><label>Current</label><span class="live-price">${fmtPrice(t.currentPrice || t.entry)}</span></div>
      <div class="trade-info-item"><label>Qty</label><span>${fmt(t.quantity, 4)}</span></div>
      <div class="trade-info-item"><label>SL</label><span class="text-red">${t.sl ? fmtPrice(t.sl) : '—'}</span></div>
      <div class="trade-info-item"><label>TP</label><span class="text-green">${t.tp ? fmtPrice(t.tp) : '—'}</span></div>
      <div class="trade-info-item"><label>Duration</label><span>${duration(durMs)}</span></div>
    </div>
    <div class="trade-actions">
      <button class="trade-btn" onclick="partialClose('${t.id}', 25)">Close 25%</button>
      <button class="trade-btn" onclick="partialClose('${t.id}', 50)">Close 50%</button>
      <button class="trade-btn" onclick="partialClose('${t.id}', 75)">Close 75%</button>
      <button class="trade-btn danger" onclick="closeTrade('${t.id}', 'manual')">Close 100%</button>
    </div>
    <div class="trade-actions" style="margin-top:6px">
      <button class="trade-btn" onclick="setBreakEven('${t.id}')">Break Even</button>
      <button class="trade-btn" onclick="setTrailing('${t.id}')">Trailing Stop</button>
      <button class="trade-btn" onclick="moveSL('${t.id}')">Move SL</button>
      <button class="trade-btn" onclick="moveTP('${t.id}')">Move TP</button>
    </div>
  </div>`;
}

function renderClosedTrade(t) {
  const dir = (t.direction || '').toLowerCase();
  return `<div class="trade-card">
    <div class="trade-header">
      <div class="trade-symbol-row">
        <span class="fw-700">${t.symbol}</span>
        <span class="trade-dir-badge ${dir}">${t.direction}</span>
      </div>
      <div class="trade-pnl">
        <div class="pnl-value ${pnlClass(t.pnl)}">${fmtPnl(t.pnl)}</div>
        <div style="font-size:10px;color:var(--text3)">${t.closeReason || 'manual'}</div>
      </div>
    </div>
    <div class="trade-info-grid">
      <div class="trade-info-item"><label>Entry</label><span>${fmtPrice(t.entry)}</span></div>
      <div class="trade-info-item"><label>Exit</label><span>${fmtPrice(t.exitPrice || 0)}</span></div>
      <div class="trade-info-item"><label>ROI</label><span class="${pnlClass(t.roi)}">${fmt(t.roi)}%</span></div>
      <div class="trade-info-item"><label>Duration</label><span>${t.duration ? t.duration + 'm' : '—'}</span></div>
      <div class="trade-info-item"><label>Closed</label><span>${timeAgo(t.closedAt)}</span></div>
    </div>
  </div>`;
}

async function closeTrade(id, reason = 'manual') {
  if (!confirm('Close this trade?')) return;
  const res = await apiPost(`/api/trades/${id}/close`, { percent: 100, reason });
  if (res?.success) { notify('Trade Closed', fmtPnl(res.pnl), parseFloat(res.pnl) >= 0 ? 'success' : 'danger'); loadTrades(); }
  else notify('Error', res?.error || 'Failed', 'danger');
}
async function partialClose(id, pct) {
  const res = await apiPost(`/api/trades/${id}/close`, { percent: pct, reason: `partial_${pct}` });
  if (res?.success) { notify(`Closed ${pct}%`, fmtPnl(res.partialPnl), 'success'); loadTrades(); }
}
async function setBreakEven(id) {
  const res = await apiPut(`/api/trades/${id}/breakeven`, {});
  if (res?.success) notify('Break Even Set', 'SL moved to entry', 'success');
}
async function setTrailing(id) {
  const step = prompt('Trailing step % (default 0.5):', '0.5');
  if (!step) return;
  const res = await apiPut(`/api/trades/${id}/trailing`, { step: parseFloat(step) });
  if (res?.success) notify('Trailing Stop Set', step + '%', 'success');
}
async function moveSL(id) {
  const sl = prompt('New Stop Loss price:');
  if (!sl) return;
  const res = await apiPut(`/api/trades/${id}/sl`, { sl: parseFloat(sl) });
  if (res?.success) { notify('SL Updated', fmtPrice(sl), 'info'); loadTrades(); }
}
async function moveTP(id) {
  const tp = prompt('New Take Profit price:');
  if (!tp) return;
  const res = await apiPut(`/api/trades/${id}/tp`, { tp: parseFloat(tp) });
  if (res?.success) { notify('TP Updated', fmtPrice(tp), 'info'); loadTrades(); }
}

// Trade tabs
document.querySelectorAll('.trade-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.trade-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    tradeTab = btn.dataset.tab;
    loadTrades();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EARNINGS / STATISTICS
// ─────────────────────────────────────────────────────────────────────────────
async function loadEarnings() {
  const stats = await apiGet('/api/stats');
  if (!stats) return;
  const s = stats;

  document.getElementById('earn-lifetime').textContent = '$' + fmt(s.lifetimeProfit || 0);
  document.getElementById('earn-today').textContent = '$' + fmt(s.todayProfit || 0);
  document.getElementById('earn-week').textContent = '$' + fmt(s.weekProfit || 0);
  document.getElementById('earn-month').textContent = '$' + fmt(s.monthProfit || 0);
  document.getElementById('earn-winrate').textContent = (s.winRate || 0) + '%';
  document.getElementById('earn-avg-rr').textContent = fmt(s.avgRR || 0);
  document.getElementById('earn-largest-win').textContent = '$' + fmt(s.largestWin || 0);
  document.getElementById('earn-largest-loss').textContent = '$' + fmt(Math.abs(s.largestLoss || 0));
  document.getElementById('earn-total-trades').textContent = s.totalTrades || 0;
  document.getElementById('earn-wins').textContent = s.winTrades || 0;
  document.getElementById('earn-losses').textContent = s.lossTrades || 0;
  document.getElementById('earn-net').textContent = '$' + fmt(s.netProfit || 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKET
// ─────────────────────────────────────────────────────────────────────────────
let allTickers = [];
let marketFilter = '';

async function loadMarket() {
  document.getElementById('market-table-body').innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text3)"><div class="spinner" style="margin:0 auto"></div></td></tr>';
  try {
    const tickers = await fetch('/api/market/tickers').then(r => r.json());
    allTickers = tickers;
    updateMarketTable(tickers);
  } catch { }
}

function updateMarketTable(tickers) {
  allTickers = tickers;
  const filter = marketFilter.toLowerCase();
  const filtered = filter ? tickers.filter(t => t.symbol.toLowerCase().includes(filter)) : tickers;
  const sorted = filtered.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));

  const tbody = document.getElementById('market-table-body');
  tbody.innerHTML = sorted.slice(0, 100).map(t => {
    const chg = parseFloat(t.priceChangePercent);
    const chgClass = chg >= 0 ? 'change-up' : 'change-down';
    const status = chg >= 2 ? 'bullish' : chg <= -2 ? 'bearish' : 'neutral';
    const signal = chg >= 3 ? 'BUY' : chg <= -3 ? 'SELL' : '—';
    const signalColor = signal === 'BUY' ? 'var(--green)' : signal === 'SELL' ? 'var(--red)' : 'var(--text3)';
    const score = Math.min(Math.abs(chg) * 10 + 50, 99).toFixed(0);
    return `<tr>
      <td>${t.symbol.replace('USDT', '<span style="color:var(--text3);font-size:10px">USDT</span>')}</td>
      <td>${fmtPrice(t.lastPrice)}</td>
      <td class="${chgClass}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</td>
      <td>${fmtVol(t.quoteVolume)}</td>
      <td><span class="${chgClass}">${status === 'bullish' ? '▲' : status === 'bearish' ? '▼' : '—'}</span></td>
      <td style="color:${signalColor};font-weight:600">${signal}</td>
      <td style="color:var(--accent)">${score}</td>
      <td><span class="market-status ${status}">${status.toUpperCase()}</span></td>
    </tr>`;
  }).join('');
}

document.getElementById('market-search')?.addEventListener('input', (e) => {
  marketFilter = e.target.value;
  if (allTickers.length) updateMarketTable(allTickers);
});

// ─────────────────────────────────────────────────────────────────────────────
// ASSETS
// ─────────────────────────────────────────────────────────────────────────────
async function loadAssets() {
  const cont = document.getElementById('assets-list');
  const snap = currentUser?.accountSnapshot;
  if (!snap) {
    cont.innerHTML = '<div class="empty-state"><div class="empty-icon">💼</div><p>Connect your Binance API to see assets</p></div>';
    return;
  }
  const assets = snap.assets || [];
  if (!assets.length) {
    cont.innerHTML = '<div class="empty-state"><p>No assets found</p></div>';
    return;
  }
  cont.innerHTML = assets.map(a => {
    const asset = a.asset || a.walletBalance;
    const free = parseFloat(a.free || a.availableBalance || 0);
    const locked = parseFloat(a.locked || 0);
    return `<div class="card" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div>
        <div class="fw-700">${a.asset}</div>
        <div class="text-sm text-muted">Free: ${fmt(free, 6)}</div>
      </div>
      <div style="text-align:right">
        <div class="fw-700">${fmt(free + locked, 6)}</div>
        ${locked > 0 ? `<div class="text-xs text-muted">Locked: ${fmt(locked, 6)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY
// ─────────────────────────────────────────────────────────────────────────────
function loadStrategy() {
  const strategies = [
    { name: 'Smart Money Concept', desc: 'Institutional order flow analysis using BOS, CHoCH, Order Blocks, and FVG.', tags: ['BOS', 'CHoCH', 'Order Block', 'FVG', 'Liquidity Sweep'], active: true },
    { name: 'EMA Trend Following', desc: 'Multi-timeframe EMA crossover with VWAP confirmation.', tags: ['EMA 20', 'EMA 50', 'EMA 200', 'VWAP'], active: false },
    { name: 'RSI + ATR Scalping', desc: 'RSI oversold/overbought zones with ATR-based dynamic SL/TP.', tags: ['RSI', 'ATR', 'Scalp'], active: false },
    { name: 'Volume Spike Entry', desc: 'Enters on confirmed volume spikes with trend alignment.', tags: ['Volume', 'Spike', 'Trend'], active: false },
  ];
  document.getElementById('strategy-list').innerHTML = strategies.map(s => `
    <div class="strategy-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div class="strategy-name">${s.name}</div>
        ${s.active ? '<span style="font-size:10px;padding:3px 10px;border-radius:20px;background:rgba(0,230,118,0.1);color:var(--green);border:1px solid rgba(0,230,118,0.3)">ACTIVE</span>' : ''}
      </div>
      <div class="strategy-desc">${s.desc}</div>
      <div class="strategy-tags">${s.tags.map(t => `<span class="strategy-tag">${t}</span>`).join('')}</div>
    </div>
  `).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// API BIND
// ─────────────────────────────────────────────────────────────────────────────
function loadAPIBind() {
  const u = currentUser;
  const connected = !!(u?.binanceApiKey);
  document.getElementById('api-status-card').className = `api-status-card ${connected ? 'api-connected' : 'api-disconnected'}`;
  document.getElementById('api-status-dot').className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  document.getElementById('api-status-text').textContent = connected ? 'Connected' : 'Not Connected';
  document.getElementById('api-mode').textContent = u?.tradeMode === 'real' ? 'Real Trading' : 'Demo Mode';
  document.getElementById('api-type').textContent = u?.accountType === 'futures' ? 'Futures' : 'Spot';

  const modeToggle = document.getElementById('modeToggle');
  if (modeToggle) {
    modeToggle.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === (u?.tradeMode || 'demo'));
    });
  }
}

document.getElementById('bindApiForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.textContent = 'Connecting...'; btn.disabled = true;
  const res = await apiPost('/api/user/bind-api', {
    apiKey: document.getElementById('apiKey').value,
    apiSecret: document.getElementById('apiSecret').value,
    accountType: document.getElementById('accountType').value,
    testnet: document.getElementById('testnet').checked,
  });
  btn.textContent = 'Connect API'; btn.disabled = false;
  if (res?.success) {
    notify('API Connected!', 'Account synced successfully', 'success');
    const me = await apiGet('/api/auth/me');
    if (me) { currentUser = me; localStorage.setItem('user', JSON.stringify(me)); }
    loadAPIBind();
  } else {
    notify('Error', res?.error || 'Failed to connect', 'danger');
  }
});

document.querySelectorAll('#modeToggle .toggle-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('#modeToggle .toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const res = await apiPost('/api/user/switch-mode', { mode: btn.dataset.mode, accountType: currentUser?.accountType });
    if (res?.success) {
      currentUser.tradeMode = btn.dataset.mode;
      localStorage.setItem('user', JSON.stringify(currentUser));
      notify('Mode Switched', btn.dataset.mode.toUpperCase(), 'info');
      loadAPIBind(); updateUserUI();
    }
  });
});

document.getElementById('syncBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('syncBtn');
  btn.textContent = 'Syncing...'; btn.disabled = true;
  const res = await apiGet('/api/user/sync');
  btn.textContent = 'Sync Account'; btn.disabled = false;
  if (res?.success) {
    const me = await apiGet('/api/auth/me');
    if (me) { currentUser = me; localStorage.setItem('user', JSON.stringify(me)); }
    notify('Synced!', 'Account data updated', 'success');
    loadAPIBind();
  } else {
    notify('Error', res?.error, 'danger');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// REFERRAL / INVITE
// ─────────────────────────────────────────────────────────────────────────────
async function loadReferral() {
  const data = await apiGet('/api/referral');
  if (!data) return;
  const link = `${window.location.origin}/register.html?ref=${data.referralCode}`;
  document.getElementById('ref-code').textContent = data.referralCode;
  document.getElementById('ref-link').value = link;
  document.getElementById('ref-total').textContent = data.totalReferrals;
  document.getElementById('ref-premium').textContent = data.premiumReferrals;
  document.getElementById('ref-earnings').textContent = '$' + fmt(data.totalEarnings || 0);

  const list = document.getElementById('ref-list');
  if (data.referrals && data.referrals.length > 0) {
    list.innerHTML = data.referrals.map(r => `
      <div class="card" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div>
          <div class="fw-700">@${r.username}</div>
          <div class="text-xs text-muted">${timeAgo(r.joinedAt)}</div>
        </div>
        <span class="${r.isPremium ? 'text-green' : 'text-muted'}">${r.isPremium ? '⭐ Premium' : 'Free'}</span>
      </div>
    `).join('');
  } else {
    list.innerHTML = '<div class="empty-state"><p>No referrals yet. Share your link!</p></div>';
  }
}

document.getElementById('copyRefCode')?.addEventListener('click', () => copyText(document.getElementById('ref-code').textContent));
document.getElementById('copyRefLink')?.addEventListener('click', () => copyText(document.getElementById('ref-link').value));

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE
// ─────────────────────────────────────────────────────────────────────────────
async function loadProfile() {
  const u = await apiGet('/api/auth/me');
  if (!u) return;
  currentUser = u; localStorage.setItem('user', JSON.stringify(u));
  const s = u.stats || {};
  const snap = u.accountSnapshot || {};

  document.getElementById('profile-avatar').textContent = (u.username || 'U')[0].toUpperCase();
  document.getElementById('profile-name').textContent = u.username;
  document.getElementById('profile-email').textContent = u.email;
  document.getElementById('profile-balance').textContent = '$' + fmt(snap.balance || 0);
  document.getElementById('profile-winrate').textContent = (s.winRate || 0) + '%';
  document.getElementById('profile-profit').textContent = '$' + fmt(s.totalProfit || 0);
  document.getElementById('profile-loss').textContent = '$' + fmt(s.totalLoss || 0);
  document.getElementById('profile-net').textContent = '$' + fmt(s.netProfit || 0);
  document.getElementById('profile-ref-earn').textContent = '$' + fmt(u.referralEarnings || 0);
  document.getElementById('profile-plan').textContent = u.isPremium ? ('Premium — ' + u.subscriptionPlan) : 'Free';
  document.getElementById('profile-api-status').textContent = u.binanceApiKey ? 'Connected' : 'Not Connected';
  document.getElementById('profile-account-type').textContent = u.accountType || 'spot';
  document.getElementById('profile-mode').textContent = u.tradeMode || 'demo';

  const expiry = u.subscriptionExpiry ? new Date(u.subscriptionExpiry).toLocaleDateString() : 'N/A';
  document.getElementById('profile-expiry').textContent = expiry;

  // Support info
  const support = await fetch('/api/support').then(r => r.json()).catch(() => ({}));
  document.getElementById('support-telegram').textContent = support.telegramUsername || '—';
  document.getElementById('support-telegram').href = support.telegramLink || '#';
  document.getElementById('support-whatsapp').textContent = support.whatsapp || '—';
  document.getElementById('support-email').textContent = support.email || '—';
  document.getElementById('support-msg').textContent = support.supportMessage || '';
}

document.getElementById('logoutBtn')?.addEventListener('click', () => {
  if (confirm('Log out?')) logout();
});
