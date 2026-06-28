const { getKlines, getPublicTickers } = require('./binance');
const { analyzeSymbol } = require('./strategy');
const { isOnCooldown, setCooldown } = require('./risk');
const db = require('./db');
const config = require('./config');
const { v4: uuidv4 } = require('uuid');

let scanning = false;
let lastScanTime = 0;
let cachedTickers = [];
let io = null;

function setIO(socketIO) { io = socketIO; }

// ── Get USDT symbols from cached tickers ──────────────────────────────────────
async function getUSDTSymbols(limit = 100) {
  try {
    const tickers = await getPublicTickers();
    cachedTickers = tickers;
    return tickers
      .filter(t => parseFloat(t.volume) > 0)
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, limit)
      .map(t => t.symbol);
  } catch {
    return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
  }
}

// ── Scan a single symbol ──────────────────────────────────────────────────────
async function scanSymbol(symbol) {
  try {
    if (isOnCooldown(symbol, 'futures')) return null;
    const [klines4h, klines1h] = await Promise.all([
      getKlines(symbol, '4h', 200, true),
      getKlines(symbol, '1h', 100, true),
    ]);
    return analyzeSymbol(symbol, klines4h, klines1h);
  } catch (err) {
    return null;
  }
}

// ── Deduplicate: never send a signal for same symbol+direction within cooldown ─
function isDuplicate(signal) {
  const recent = db.getSignals();
  const cutoff = Date.now() - config.SIGNALS.COOLDOWN_MINUTES * 60 * 1000;
  return recent.some(s =>
    s.symbol === signal.symbol &&
    s.direction === signal.direction &&
    new Date(s.generatedAt).getTime() > cutoff
  );
}

// ── Main scan loop ────────────────────────────────────────────────────────────
async function runScan() {
  if (scanning) return;
  scanning = true;
  lastScanTime = Date.now();
  console.log('[SCANNER] Starting market scan...');

  try {
    const symbols = await getUSDTSymbols(config.SCANNER.MAX_SYMBOLS);
    const BATCH = 5;
    const newSignals = [];

    for (let i = 0; i < symbols.length; i += BATCH) {
      const batch = symbols.slice(i, i + BATCH);
      const results = await Promise.allSettled(batch.map(s => scanSymbol(s)));
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          const signal = r.value;
          if (!isDuplicate(signal)) {
            signal.id = uuidv4();
            signal.status = 'active';
            db.addSignal(signal);
            setCooldown(signal.symbol, 'futures');
            newSignals.push(signal);
            if (io) io.emit('newSignal', signal);
            console.log(`[SCANNER] Signal: ${signal.symbol} ${signal.direction} Score:${signal.score}`);
          }
        }
      }
      // Small delay between batches to avoid rate limits
      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`[SCANNER] Scan complete. ${newSignals.length} new signals from ${symbols.length} symbols.`);
  } catch (err) {
    console.error('[SCANNER] Error:', err.message);
  } finally {
    scanning = false;
  }
}

// ── Broadcast live tickers to connected clients ───────────────────────────────
async function broadcastTickers() {
  if (!io) return;
  try {
    const tickers = await getPublicTickers();
    cachedTickers = tickers;
    io.emit('marketTickers', tickers);
  } catch { }
}

// ── Getter for cached tickers ──────────────────────────────────────────────────
function getCachedTickers() { return cachedTickers; }

module.exports = { runScan, broadcastTickers, getCachedTickers, setIO };
