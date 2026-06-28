require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const cron = require('node-cron');

const config = require('./config');
const db = require('./db');
const { register, login, adminLogin, verifyToken, verifyAdmin, publicUser } = require('./auth');
const { syncUserAccount, switchMode } = require('./sync');
const { encryptKey, decryptKey, closePosition } = require('./binance');
const { validateTrade, updateStatsOnClose, isOnCooldown, setCooldown } = require('./risk');
const { getReferralDashboard, creditReferrer } = require('./referral');
const adminLib = require('./admin');
const scanner = require('./scanner');
const socketLib = require('./socket');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// ── Init Socket.IO ────────────────────────────────────────────────────────────
const io = socketLib.initSocket(server);
scanner.setIO(io);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('tiny'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use('/api/', limiter);

// ── Auth routes ───────────────────────────────────────────────────────────────
app.post('/api/auth/register', register);
app.post('/api/auth/login', login);
app.post('/api/auth/admin-login', adminLogin);

app.get('/api/auth/me', verifyToken, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(publicUser(user));
});

// ── User API key binding ──────────────────────────────────────────────────────
app.post('/api/user/bind-api', verifyToken, async (req, res) => {
  const { apiKey, apiSecret, accountType, testnet } = req.body;
  if (!apiKey || !apiSecret) return res.status(400).json({ error: 'API key and secret required' });
  const encKey = encryptKey(apiKey);
  const encSecret = encryptKey(apiSecret);
  db.updateUser(req.user.id, u => {
    u.binanceApiKey = encKey;
    u.binanceApiSecret = encSecret;
    u.accountType = accountType || 'futures';
    u.binanceTestnet = testnet !== false;
    u.apiConnectedAt = new Date().toISOString();
  });
  try {
    const data = await syncUserAccount(req.user.id);
    res.json({ success: true, message: 'API connected and account synced', data });
  } catch (err) {
    res.json({ success: true, message: 'API saved. Sync failed: ' + err.message });
  }
});

app.post('/api/user/switch-mode', verifyToken, async (req, res) => {
  const { mode, accountType } = req.body;
  try {
    const data = await switchMode(req.user.id, mode, accountType);
    res.json({ success: true, mode, accountType, data });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/user/sync', verifyToken, async (req, res) => {
  try {
    const data = await syncUserAccount(req.user.id);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Profile ───────────────────────────────────────────────────────────────────
app.get('/api/user/profile', verifyToken, (req, res) => {
  const user = db.getUserById(req.user.id);
  res.json(publicUser(user));
});

app.put('/api/user/profile', verifyToken, async (req, res) => {
  const { username, email } = req.body;
  db.updateUser(req.user.id, u => {
    if (username) u.username = username;
    if (email) u.email = email;
  });
  res.json({ success: true });
});

// ── Signals ───────────────────────────────────────────────────────────────────
app.get('/api/signals', verifyToken, (req, res) => {
  const { limit = 50, symbol, direction } = req.query;
  let signals = db.getSignals();
  if (symbol) signals = signals.filter(s => s.symbol === symbol);
  if (direction) signals = signals.filter(s => s.direction === direction);
  res.json(signals.slice(0, parseInt(limit)));
});

app.get('/api/signals/latest', (req, res) => {
  res.json(db.getSignals().slice(0, 10));
});

// ── Trades ────────────────────────────────────────────────────────────────────
app.get('/api/trades', verifyToken, (req, res) => {
  const { status } = req.query;
  let trades = db.getTradesByUser(req.user.id);
  if (status) trades = trades.filter(t => t.status === status);
  res.json(trades);
});

app.post('/api/trades/open', verifyToken, async (req, res) => {
  const { symbol, direction, entry, sl, tp, quantity, leverage, source } = req.body;
  if (!symbol || !direction || !entry) return res.status(400).json({ error: 'Missing fields' });

  const user = db.getUserById(req.user.id);
  const signal = { symbol, direction, entry: parseFloat(entry), sl: parseFloat(sl), tp: parseFloat(tp), rr: sl ? Math.abs(parseFloat(tp) - parseFloat(entry)) / Math.abs(parseFloat(entry) - parseFloat(sl)) : 2, score: 90 };

  const validation = validateTrade(user, signal, user.accountSnapshot?.balance || 1000);
  if (!validation.valid) return res.status(400).json({ error: validation.errors.join(', ') });

  const trade = {
    id: uuidv4(),
    userId: req.user.id,
    symbol, direction,
    entry: parseFloat(entry),
    sl: sl ? parseFloat(sl) : null,
    tp: tp ? parseFloat(tp) : null,
    quantity: parseFloat(quantity || 0),
    leverage: parseInt(leverage || 1),
    status: 'open',
    source: source || 'manual',
    accountType: user.accountType,
    openedAt: new Date().toISOString(),
    closedAt: null, pnl: 0, roi: 0,
    breakEvenSet: false, trailingStop: null,
  };

  db.addTrade(trade);
  socketLib.emitToUser(req.user.id, 'tradeOpened', trade);
  res.json({ success: true, trade });
});

app.post('/api/trades/:id/close', verifyToken, async (req, res) => {
  const { percent = 100, reason = 'manual', exitPrice } = req.body;
  const trade = db.getTrades().find(t => t.id === req.params.id && t.userId === req.user.id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });

  const pct = parseFloat(percent);
  const exit = exitPrice ? parseFloat(exitPrice) : trade.currentPrice || trade.entry;

  if (pct >= 100) {
    const diff = trade.direction === 'BUY' || trade.direction === 'LONG' ? exit - trade.entry : trade.entry - exit;
    const pnl = diff * (trade.quantity || 1) * (trade.leverage || 1);

    db.updateTrade(trade.id, t => {
      t.status = 'closed'; t.closeReason = reason; t.exitPrice = exit;
      t.pnl = pnl; t.roi = trade.entry > 0 ? (diff / trade.entry) * 100 * (trade.leverage || 1) : 0;
      t.closedAt = new Date().toISOString();
      t.duration = Math.round((Date.now() - new Date(t.openedAt).getTime()) / 60000);
    });

    const user = db.getUserById(req.user.id);
    if (user.tradeMode === 'real' && user.binanceApiKey) {
      try { await closePosition(user, trade.symbol, 100, trade.direction === 'BUY' ? 'SELL' : 'BUY'); } catch { }
    }

    updateStatsOnClose(req.user.id, { ...trade, pnl });
    socketLib.emitToUser(req.user.id, 'tradeClosed', { tradeId: trade.id, pnl, reason });
    res.json({ success: true, pnl, reason });
  } else {
    // Partial close
    const closedQty = (trade.quantity || 1) * pct / 100;
    const diff = trade.direction === 'BUY' || trade.direction === 'LONG' ? exit - trade.entry : trade.entry - exit;
    const partialPnl = diff * closedQty * (trade.leverage || 1);
    db.updateTrade(trade.id, t => {
      t.quantity = t.quantity - closedQty;
      t.partialCloses = [...(t.partialCloses || []), { percent: pct, price: exit, pnl: partialPnl, at: new Date().toISOString() }];
    });
    res.json({ success: true, closedQty, partialPnl });
  }
});

app.put('/api/trades/:id/sl', verifyToken, (req, res) => {
  const { sl } = req.body;
  const ok = db.updateTrade(req.params.id, t => { if (t.userId === req.user.id) t.sl = parseFloat(sl); });
  res.json({ success: ok });
});

app.put('/api/trades/:id/tp', verifyToken, (req, res) => {
  const { tp } = req.body;
  const ok = db.updateTrade(req.params.id, t => { if (t.userId === req.user.id) t.tp = parseFloat(tp); });
  res.json({ success: ok });
});

app.put('/api/trades/:id/breakeven', verifyToken, (req, res) => {
  const ok = db.updateTrade(req.params.id, t => {
    if (t.userId === req.user.id) { t.sl = t.entry; t.breakEvenSet = true; }
  });
  res.json({ success: ok });
});

app.put('/api/trades/:id/trailing', verifyToken, (req, res) => {
  const { step } = req.body;
  const ok = db.updateTrade(req.params.id, t => {
    if (t.userId === req.user.id) t.trailingStop = parseFloat(step || config.RISK.TRAILING_STEP);
  });
  res.json({ success: ok });
});

// ── Market ────────────────────────────────────────────────────────────────────
app.get('/api/market/tickers', async (req, res) => {
  const cached = scanner.getCachedTickers();
  if (cached.length > 0) return res.json(cached);
  try {
    const { getPublicTickers } = require('./binance');
    const tickers = await getPublicTickers();
    res.json(tickers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Referral ──────────────────────────────────────────────────────────────────
app.get('/api/referral', verifyToken, (req, res) => {
  res.json(getReferralDashboard(req.user.id));
});

// ── Help / Support settings ───────────────────────────────────────────────────
app.get('/api/support', (req, res) => {
  res.json(db.getGlobalSettings());
});

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', verifyToken, (req, res) => {
  const user = db.getUserById(req.user.id);
  res.json(user?.stats || {});
});

// ═════════════════ ADMIN ROUTES ═══════════════════════════════════════════════
app.get('/api/admin/dashboard', verifyAdmin, (req, res) => res.json(adminLib.getDashboardStats()));
app.get('/api/admin/users', verifyAdmin, (req, res) => res.json(adminLib.getAllUsers()));
app.get('/api/admin/users/:id', verifyAdmin, (req, res) => res.json(adminLib.getUser(req.params.id)));
app.post('/api/admin/users/:id/approve', verifyAdmin, (req, res) => { adminLib.approveUser(req.params.id); res.json({ success: true }); });
app.post('/api/admin/users/:id/ban', verifyAdmin, (req, res) => { adminLib.banUser(req.params.id); res.json({ success: true }); });
app.post('/api/admin/users/:id/unban', verifyAdmin, (req, res) => { adminLib.unbanUser(req.params.id); res.json({ success: true }); });
app.delete('/api/admin/users/:id', verifyAdmin, (req, res) => { adminLib.deleteUser(req.params.id); res.json({ success: true }); });
app.post('/api/admin/users/:id/reset-stats', verifyAdmin, (req, res) => { adminLib.resetStats(req.params.id); res.json({ success: true }); });
app.post('/api/admin/users/:id/reset-password', verifyAdmin, async (req, res) => {
  await adminLib.resetPassword(req.params.id, req.body.password);
  res.json({ success: true });
});
app.post('/api/admin/users/:id/subscription', verifyAdmin, (req, res) => {
  adminLib.setSubscription(req.params.id, req.body);
  creditReferrer(req.params.id, req.body.amount || 0);
  res.json({ success: true });
});
app.get('/api/admin/signals', verifyAdmin, (req, res) => res.json(adminLib.getAdminSignals()));
app.get('/api/admin/trades', verifyAdmin, (req, res) => res.json(db.getTrades()));
app.get('/api/admin/revenue', verifyAdmin, (req, res) => res.json(adminLib.getRevenue()));
app.get('/api/admin/referrals', verifyAdmin, (req, res) => res.json(adminLib.getReferralStats()));
app.get('/api/admin/logs', verifyAdmin, (req, res) => res.json(adminLib.getLogs()));
app.get('/api/admin/settings', verifyAdmin, (req, res) => res.json(adminLib.getSettings()));
app.put('/api/admin/settings', verifyAdmin, (req, res) => { adminLib.updateSettings(req.body); res.json({ success: true }); });

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Cron jobs ─────────────────────────────────────────────────────────────────
// Market scanner every minute
cron.schedule('* * * * *', () => scanner.runScan().catch(console.error));

// Broadcast market tickers every 5 seconds
setInterval(() => scanner.broadcastTickers().catch(() => { }), 5000);

// DB backup every 30 minutes
cron.schedule('*/30 * * * *', () => { try { db.backup(); } catch (e) { console.error('Backup failed:', e.message); } });

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = config.PORT;
server.listen(PORT, () => {
  console.log(`\n🚀 AI Crypto Trading Platform running on port ${PORT}`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Admin: /admin.html`);
  console.log(`   Mode: ${process.env.NODE_ENV || 'development'}\n`);
  // Run initial scan
  setTimeout(() => scanner.runScan().catch(console.error), 3000);
});

module.exports = { app, server };
