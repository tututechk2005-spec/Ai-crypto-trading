// Smart Money Concept Strategy Engine
const { calcATR } = require('./risk');

// ── Indicator helpers ─────────────────────────────────────────────────────────
function calcEMA(closes, period) {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calcVWAP(klines) {
  let cumVolPrice = 0, cumVol = 0;
  for (const k of klines) {
    const tp = (parseFloat(k[2]) + parseFloat(k[3]) + parseFloat(k[4])) / 3;
    const vol = parseFloat(k[5]);
    cumVolPrice += tp * vol;
    cumVol += vol;
  }
  return cumVol > 0 ? cumVolPrice / cumVol : 0;
}

function detectBOS(klines, lookback = 20) {
  // Break of Structure: price breaks above/below recent swing high/low
  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));
  const closes = klines.map(k => parseFloat(k[4]));
  const last = closes[closes.length - 1];
  const prevHigh = Math.max(...highs.slice(-lookback - 1, -1));
  const prevLow = Math.min(...lows.slice(-lookback - 1, -1));

  if (last > prevHigh) return 'BULLISH';
  if (last < prevLow) return 'BEARISH';
  return 'NONE';
}

function detectCHOCH(klines, lookback = 10) {
  // Change of Character: momentum shift
  const closes = klines.map(k => parseFloat(k[4]));
  const ema10 = calcEMA(closes.slice(-lookback), lookback);
  const ema10prev = calcEMA(closes.slice(-lookback - 1, -1), lookback);
  if (ema10 > ema10prev * 1.001) return 'BULLISH';
  if (ema10 < ema10prev * 0.999) return 'BEARISH';
  return 'NONE';
}

function detectOrderBlock(klines, lookback = 20) {
  // Last bearish candle before a bullish move (bullish OB) and vice versa
  const recent = klines.slice(-lookback);
  let bullishOB = null, bearishOB = null;
  for (let i = 1; i < recent.length - 1; i++) {
    const open = parseFloat(recent[i][1]);
    const close = parseFloat(recent[i][4]);
    const nextClose = parseFloat(recent[i + 1][4]);
    // Bullish OB: bearish candle followed by strong bullish candle
    if (close < open && nextClose > open * 1.005) {
      bullishOB = { high: parseFloat(recent[i][2]), low: parseFloat(recent[i][3]), idx: i };
    }
    // Bearish OB: bullish candle followed by strong bearish candle
    if (close > open && nextClose < open * 0.995) {
      bearishOB = { high: parseFloat(recent[i][2]), low: parseFloat(recent[i][3]), idx: i };
    }
  }
  return { bullishOB, bearishOB };
}

function detectFVG(klines) {
  // Fair Value Gap: gap between candle i-2 high and candle i low
  const fvgs = [];
  for (let i = 2; i < klines.length; i++) {
    const prevHigh = parseFloat(klines[i - 2][2]);
    const prevLow = parseFloat(klines[i - 2][3]);
    const currHigh = parseFloat(klines[i][2]);
    const currLow = parseFloat(klines[i][3]);
    if (currLow > prevHigh) fvgs.push({ type: 'BULLISH', top: currLow, bottom: prevHigh });
    if (currHigh < prevLow) fvgs.push({ type: 'BEARISH', top: prevLow, bottom: currHigh });
  }
  return fvgs.slice(-5);
}

function detectLiquiditySweep(klines, lookback = 50) {
  // Price briefly wicks below/above a key level then reverses
  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));
  const closes = klines.map(k => parseFloat(k[4]));
  const last = closes.length - 1;
  const recentHigh = Math.max(...highs.slice(-lookback - 1, -2));
  const recentLow = Math.min(...lows.slice(-lookback - 1, -2));
  const wicked = lows[last] < recentLow && closes[last] > recentLow;
  const wickedUp = highs[last] > recentHigh && closes[last] < recentHigh;
  if (wicked) return 'BULLISH';
  if (wickedUp) return 'BEARISH';
  return 'NONE';
}

function detectVolumeSpike(klines, threshold = 2.0) {
  const vols = klines.map(k => parseFloat(k[5]));
  const avgVol = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
  const lastVol = vols[vols.length - 1];
  return lastVol >= avgVol * threshold;
}

// ── Main analysis function ───────────────────────────────────────────────────
function analyzeSymbol(symbol, klines4h, klines1h) {
  if (!klines4h || klines4h.length < 50) return null;

  const closes4h = klines4h.map(k => parseFloat(k[4]));
  const closes1h = klines1h && klines1h.length > 20 ? klines1h.map(k => parseFloat(k[4])) : closes4h;

  const last = closes4h[closes4h.length - 1];
  const atr = calcATR(klines4h);

  // EMAs
  const ema20 = calcEMA(closes4h, 20);
  const ema50 = calcEMA(closes4h, 50);
  const ema200 = calcEMA(closes4h, 200);

  const trend4h = ema20 > ema50 && ema50 > ema200 ? 'BULLISH'
    : ema20 < ema50 && ema50 < ema200 ? 'BEARISH' : 'NEUTRAL';

  const ema20_1h = calcEMA(closes1h, 20);
  const ema50_1h = calcEMA(closes1h, 50);
  const trend1h = ema20_1h > ema50_1h ? 'BULLISH' : ema20_1h < ema50_1h ? 'BEARISH' : 'NEUTRAL';

  const rsi = calcRSI(closes4h);
  const vwap = calcVWAP(klines4h.slice(-24));
  const bos = detectBOS(klines4h);
  const choch = detectCHOCH(klines4h);
  const { bullishOB, bearishOB } = detectOrderBlock(klines4h);
  const fvgs = detectFVG(klines4h);
  const liquiditySweep = detectLiquiditySweep(klines4h);
  const volumeSpike = detectVolumeSpike(klines4h);

  // Volume metric
  const vols = klines4h.map(k => parseFloat(k[5]));
  const avgVol = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;

  // ── Build signal ───────────────────────────────────────────────────────────
  let direction = null;
  let score = 0;
  const confirmations = [];

  // Bullish conditions
  let bullScore = 0;
  if (trend4h === 'BULLISH') { bullScore += 20; confirmations.push('✓ 4H Bullish Trend'); }
  if (trend1h === 'BULLISH') { bullScore += 15; confirmations.push('✓ 1H Bullish Trend'); }
  if (bos === 'BULLISH') { bullScore += 15; confirmations.push('✓ BOS Bullish'); }
  if (choch === 'BULLISH') { bullScore += 10; confirmations.push('✓ CHoCH Bullish'); }
  if (bullishOB) { bullScore += 10; confirmations.push('✓ Bullish Order Block'); }
  if (fvgs.some(f => f.type === 'BULLISH')) { bullScore += 8; confirmations.push('✓ Bullish FVG'); }
  if (liquiditySweep === 'BULLISH') { bullScore += 12; confirmations.push('✓ Liquidity Sweep (Bullish)'); }
  if (volumeSpike) { bullScore += 5; confirmations.push('✓ Volume Spike'); }
  if (rsi >= 45 && rsi <= 70) { bullScore += 5; confirmations.push(`✓ RSI ${rsi.toFixed(1)}`); }
  if (last > vwap) { bullScore += 5; confirmations.push('✓ Above VWAP'); }
  if (last > ema200) { bullScore += 5; confirmations.push('✓ Above EMA200'); }

  // Bearish conditions
  let bearScore = 0;
  const bearConf = [];
  if (trend4h === 'BEARISH') { bearScore += 20; bearConf.push('✓ 4H Bearish Trend'); }
  if (trend1h === 'BEARISH') { bearScore += 15; bearConf.push('✓ 1H Bearish Trend'); }
  if (bos === 'BEARISH') { bearScore += 15; bearConf.push('✓ BOS Bearish'); }
  if (choch === 'BEARISH') { bearScore += 10; bearConf.push('✓ CHoCH Bearish'); }
  if (bearishOB) { bearScore += 10; bearConf.push('✓ Bearish Order Block'); }
  if (fvgs.some(f => f.type === 'BEARISH')) { bearScore += 8; bearConf.push('✓ Bearish FVG'); }
  if (liquiditySweep === 'BEARISH') { bearScore += 12; bearConf.push('✓ Liquidity Sweep (Bearish)'); }
  if (volumeSpike) { bearScore += 5; bearConf.push('✓ Volume Spike'); }
  if (rsi >= 30 && rsi <= 55) { bearScore += 5; bearConf.push(`✓ RSI ${rsi.toFixed(1)}`); }
  if (last < vwap) { bearScore += 5; bearConf.push('✓ Below VWAP'); }
  if (last < ema200) { bearScore += 5; bearConf.push('✓ Below EMA200'); }

  if (bullScore > bearScore && bullScore >= 90) {
    direction = 'BUY';
    score = Math.min(bullScore, 100);
  } else if (bearScore > bullScore && bearScore >= 90) {
    direction = 'SELL';
    score = Math.min(bearScore, 100);
    confirmations.length = 0;
    confirmations.push(...bearConf);
  }

  if (!direction) return null;

  // Entry / SL / TP
  let entry, sl, tp1, tp2;
  const atrMul = 1.5;

  if (direction === 'BUY') {
    entry = last;
    sl = entry - atr * atrMul;
    tp1 = entry + atr * atrMul * 2;
    tp2 = entry + atr * atrMul * 3;
  } else {
    entry = last;
    sl = entry + atr * atrMul;
    tp1 = entry - atr * atrMul * 2;
    tp2 = entry - atr * atrMul * 3;
  }

  const slDist = Math.abs(entry - sl);
  const tpDist = Math.abs(tp1 - entry);
  const rr = slDist > 0 ? (tpDist / slDist) : 0;

  if (rr < 2) return null;

  // Market type
  const marketType = avgVol > 50000000 ? 'HIGH_VOLUME'
    : avgVol > 10000000 ? 'MEDIUM_VOLUME' : 'LOW_VOLUME';

  return {
    symbol,
    direction,
    score: Math.round(score),
    entry: parseFloat(entry.toFixed(8)),
    sl: parseFloat(sl.toFixed(8)),
    tp: parseFloat(tp1.toFixed(8)),
    tp2: parseFloat(tp2.toFixed(8)),
    rr: parseFloat(rr.toFixed(2)),
    atr: parseFloat(atr.toFixed(8)),
    rsi: parseFloat(rsi.toFixed(1)),
    trend4h,
    trend1h,
    vwap: parseFloat(vwap.toFixed(8)),
    bos,
    choch,
    liquiditySweep,
    volumeSpike,
    marketType,
    confirmations,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { analyzeSymbol, calcEMA, calcRSI, calcATR, calcVWAP };
