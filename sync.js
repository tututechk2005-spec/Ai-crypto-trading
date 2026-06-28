const { syncAccount } = require('./binance');
const db = require('./db');
const { v4: uuidv4 } = require('uuid');

// ── Full account sync immediately after API connection ───────────────────────
async function syncUserAccount(userId) {
  const user = db.getUserById(userId);
  if (!user || !user.binanceApiKey) throw new Error('No API key configured');

  const data = await syncAccount(user);

  // Store snapshot on user
  db.updateUser(userId, u => {
    u.lastSync = new Date().toISOString();
    u.accountSnapshot = {
      balance: data.balance,
      availableBalance: data.availableBalance,
      marginBalance: data.marginBalance,
      walletBalance: data.walletBalance,
      pnl: data.pnl,
      assets: data.assets,
      syncedAt: new Date().toISOString(),
    };
  });

  // Import open positions as open trades (avoid duplicates)
  if (data.positions && data.positions.length > 0) {
    const existingTrades = db.getTradesByUser(userId);
    for (const pos of data.positions) {
      const dup = existingTrades.find(t =>
        t.symbol === pos.symbol && t.status === 'open' && t.source === 'binance_import'
      );
      if (!dup) {
        db.addTrade({
          id: uuidv4(),
          userId,
          symbol: pos.symbol,
          direction: pos.side,
          entry: pos.entryPrice,
          currentPrice: pos.markPrice,
          quantity: pos.quantity,
          leverage: pos.leverage,
          sl: null, tp: null,
          pnl: pos.unrealizedPnl,
          roi: pos.roe,
          status: 'open',
          source: 'binance_import',
          accountType: 'futures',
          openedAt: new Date().toISOString(),
          closedAt: null,
          closeReason: null,
          marginType: pos.marginType,
          liquidationPrice: pos.liquidationPrice,
        });
      }
    }
  }

  // Import open orders
  if (data.openOrders && data.openOrders.length > 0) {
    const existing = db.getTradesByUser(userId);
    for (const order of data.openOrders) {
      const dup = existing.find(t => t.binanceOrderId === String(order.orderId));
      if (!dup) {
        db.addTrade({
          id: uuidv4(),
          userId,
          binanceOrderId: String(order.orderId),
          symbol: order.symbol,
          direction: order.side,
          entry: parseFloat(order.price),
          quantity: parseFloat(order.origQty),
          status: 'pending',
          source: 'binance_order_import',
          accountType: user.accountType,
          openedAt: new Date().toISOString(),
          closedAt: null,
          closeReason: null,
        });
      }
    }
  }

  return data;
}

// ── Switch demo/real mode — reload all account data ──────────────────────────
async function switchMode(userId, mode, accountType) {
  db.updateUser(userId, u => {
    u.tradeMode = mode;
    if (accountType) u.accountType = accountType;
    u.binanceTestnet = (mode === 'demo');
  });

  // Reload fresh data if real mode with API keys
  const user = db.getUserById(userId);
  if (user.binanceApiKey) {
    try {
      return await syncUserAccount(userId);
    } catch { }
  }
  return null;
}

// ── Update live trade PNLs using latest market prices ────────────────────────
function updateLiveTrades(marketPrices) {
  const trades = db.getTrades().filter(t => t.status === 'open');
  for (const trade of trades) {
    const price = marketPrices[trade.symbol];
    if (!price) continue;

    db.updateTrade(trade.id, t => {
      t.currentPrice = price;
      const diff = trade.direction === 'BUY' || trade.direction === 'LONG'
        ? price - trade.entry
        : trade.entry - price;
      t.pnl = diff * (trade.quantity || 1) * (trade.leverage || 1);
      t.roi = trade.entry > 0 ? (diff / trade.entry) * 100 * (trade.leverage || 1) : 0;
    });
  }
}

module.exports = { syncUserAccount, switchMode, updateLiveTrades };
