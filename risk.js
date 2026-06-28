const config = require('./config');
const db = require('./db');

// ── ATR-based Stop Loss ──────────────────────────────────────────────────────
function calcATR(klines, period = 14) {
  if (klines.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < klines.length; i++) {
    const high = parseFloat(klines[i][2]);
    const low = parseFloat(klines[i][3]);
    const prevClose = parseFloat(klines[i - 1][4]);
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const recent = trs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

// ── Dynamic Position Size ────────────────────────────────────────────────────
function calcPositionSize(balance, riskPercent, entry, stopLoss, leverage = 1) {
  const riskAmount = balance * (riskPercent / 100);
  const slDistance = Math.abs(entry - stopLoss);
  if (slDistance === 0) return 0;
  const rawQty = (riskAmount * leverage) / slDistance;
  return Math.max(0, rawQty);
}

// ── Check if trade passes risk rules ────────────────────────────────────────
function validateTrade(user, signal, balance) {
  const stats = user.stats;
  const cfg = config.RISK;
  const errors = [];

  // RR check
  const rr = signal.rr || 0;
  const minRR = stats.recoveryMode ? cfg.RECOVERY_MIN_RR : cfg.MIN_RR;
  if (rr < minRR) errors.push(`RR ${rr.toFixed(2)} below minimum ${minRR}`);

  // Score check in recovery mode
  if (stats.recoveryMode && (signal.score || 0) < cfg.RECOVERY_MIN_SCORE) {
    errors.push(`Recovery mode requires score >= ${cfg.RECOVERY_MIN_SCORE}`);
  }

  // Max open trades
  const openTrades = db.getTrades().filter(t => t.userId === user.id && t.status === 'open');
  if (openTrades.length >= cfg.MAX_OPEN_TRADES) {
    errors.push(`Max open trades (${cfg.MAX_OPEN_TRADES}) reached`);
  }

  // Duplicate check — same symbol + direction
  const dup = openTrades.find(t => t.symbol === signal.symbol && t.direction === signal.direction);
  if (dup) errors.push(`Duplicate trade: ${signal.symbol} ${signal.direction} already open`);

  // Daily loss limit
  const today = new Date().toDateString();
  if (stats.dailyLossDate === today) {
    const lossLimit = balance * (cfg.DAILY_LOSS_LIMIT_PERCENT / 100);
    if (stats.dailyLossTotal >= lossLimit) {
      errors.push(`Daily loss limit reached (${cfg.DAILY_LOSS_LIMIT_PERCENT}%)`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Update stats after trade close ──────────────────────────────────────────
function updateStatsOnClose(userId, trade) {
  db.updateUser(userId, user => {
    const s = user.stats;
    const pnl = trade.pnl || 0;
    s.totalTrades++;

    if (pnl > 0) {
      s.winTrades++;
      s.totalProfit += pnl;
      s.netProfit += pnl;
      s.lifetimeProfit += pnl;
      s.largestWin = Math.max(s.largestWin, pnl);

      // Recovery: disable after one win
      if (s.recoveryMode) {
        s.recoveryMode = false;
        s.recoveryLossCount = 0;
      }
    } else if (pnl < 0) {
      s.lossTrades++;
      s.totalLoss += Math.abs(pnl);
      s.netProfit += pnl;
      s.largestLoss = Math.min(s.largestLoss, pnl);

      s.recoveryLossCount = (s.recoveryLossCount || 0) + 1;
      if (s.recoveryLossCount >= config.RISK.RECOVERY_LOSSES_TRIGGER) {
        s.recoveryMode = true;
      }

      // Daily loss tracker
      const today = new Date().toDateString();
      if (s.dailyLossDate !== today) {
        s.dailyLossDate = today;
        s.dailyLossTotal = 0;
      }
      s.dailyLossTotal += Math.abs(pnl);
    } else {
      s.breakevenTrades++;
    }

    s.winRate = s.totalTrades > 0 ? ((s.winTrades / s.totalTrades) * 100).toFixed(1) : 0;

    // Today / week / month profits (cumulative approximation)
    const today2 = new Date().toDateString();
    if (pnl !== 0) {
      s.todayProfit = (s.todayProfit || 0) + pnl;
      s.weekProfit = (s.weekProfit || 0) + pnl;
      s.monthProfit = (s.monthProfit || 0) + pnl;
    }
  });
}

// ── Cooldown tracker (in-memory, per symbol + market type) ──────────────────
const cooldowns = new Map();
function getCooldownKey(symbol, accountType) { return `${symbol}:${accountType}`; }
function isOnCooldown(symbol, accountType) {
  const key = getCooldownKey(symbol, accountType);
  const exp = cooldowns.get(key);
  if (!exp) return false;
  if (Date.now() < exp) return true;
  cooldowns.delete(key);
  return false;
}
function setCooldown(symbol, accountType, minutes = config.SIGNALS.COOLDOWN_MINUTES) {
  const key = getCooldownKey(symbol, accountType);
  cooldowns.set(key, Date.now() + minutes * 60 * 1000);
}

// ── Move SL to break even ────────────────────────────────────────────────────
function calcBreakEven(entry, fees = 0.04) {
  return entry * (1 + fees / 100);
}

module.exports = { calcATR, calcPositionSize, validateTrade, updateStatsOnClose, isOnCooldown, setCooldown, calcBreakEven };
