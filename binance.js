const crypto = require('crypto');
const axios = require('axios');
const CryptoJS = require('crypto-js');
const config = require('./config');

// ── Encrypt / Decrypt API keys ───────────────────────────────────────────────
function encryptKey(text) {
  return CryptoJS.AES.encrypt(text, config.ENCRYPTION_KEY).toString();
}
function decryptKey(cipher) {
  try {
    return CryptoJS.AES.decrypt(cipher, config.ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8);
  } catch { return ''; }
}

// ── Signature helper ─────────────────────────────────────────────────────────
function sign(queryString, secret) {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

// ── Build Binance client for a user ─────────────────────────────────────────
function buildClient(apiKey, apiSecret, accountType = 'futures', testnet = false) {
  const isFutures = accountType === 'futures';
  let base;
  if (testnet) {
    base = isFutures ? config.BINANCE.TESTNET_FUTURES_REST : config.BINANCE.TESTNET_REST;
  } else {
    base = isFutures ? config.BINANCE.FUTURES_REST_BASE : config.BINANCE.REST_BASE;
  }

  const decKey = decryptKey(apiKey);
  const decSecret = decryptKey(apiSecret);

  async function request(method, endpoint, params = {}, signed = false) {
    const ts = Date.now();
    let qs = new URLSearchParams({ ...params }).toString();
    if (signed) {
      qs += (qs ? '&' : '') + `timestamp=${ts}`;
      qs += `&signature=${sign(qs, decSecret)}`;
    }
    const url = `${base}${endpoint}${qs ? '?' + qs : ''}`;
    const headers = { 'X-MBX-APIKEY': decKey };
    const res = await axios({ method, url, headers, timeout: 10000 });
    return res.data;
  }

  return {
    // Account
    getAccount: () => request('GET', isFutures ? '/fapi/v2/account' : '/api/v3/account', {}, true),
    getBalance: () => request('GET', isFutures ? '/fapi/v2/balance' : '/api/v3/account', {}, true),
    getPositions: () => request('GET', '/fapi/v2/positionRisk', {}, true),
    getOpenOrders: (symbol = '') => request('GET', isFutures ? '/fapi/v1/openOrders' : '/api/v3/openOrders', symbol ? { symbol } : {}, true),
    getOrderHistory: (symbol, limit = 50) => request('GET', isFutures ? '/fapi/v1/allOrders' : '/api/v3/allOrders', { symbol, limit }, true),
    getTradeHistory: (symbol, limit = 100) => request('GET', isFutures ? '/fapi/v1/userTrades' : '/api/v3/myTrades', { symbol, limit }, true),
    getIncome: (type = 'REALIZED_PNL', limit = 100) => request('GET', '/fapi/v1/income', { incomeType: type, limit }, true),

    // Market
    getTicker24h: (symbol) => request('GET', isFutures ? '/fapi/v1/ticker/24hr' : '/api/v3/ticker/24hr', symbol ? { symbol } : {}),
    getKlines: (symbol, interval, limit = 200) => request('GET', isFutures ? '/fapi/v1/klines' : '/api/v3/klines', { symbol, interval, limit }),
    getExchangeInfo: () => request('GET', isFutures ? '/fapi/v1/exchangeInfo' : '/api/v3/exchangeInfo'),
    getBookTicker: (symbol) => request('GET', isFutures ? '/fapi/v1/ticker/bookTicker' : '/api/v3/ticker/bookTicker', { symbol }),
    getMarkPrice: (symbol) => request('GET', '/fapi/v1/premiumIndex', { symbol }),

    // Orders
    placeOrder: (params) => request('POST', isFutures ? '/fapi/v1/order' : '/api/v3/order', params, true),
    cancelOrder: (symbol, orderId) => request('DELETE', isFutures ? '/fapi/v1/order' : '/api/v3/order', { symbol, orderId }, true),
    closePosition: (symbol, side, quantity) => request('POST', '/fapi/v1/order', {
      symbol, side, type: 'MARKET', quantity, reduceOnly: true
    }, true),
    setLeverage: (symbol, leverage) => request('POST', '/fapi/v1/leverage', { symbol, leverage }, true),
    setMarginType: (symbol, marginType) => request('POST', '/fapi/v1/marginType', { symbol, marginType }, true),
  };
}

// ── Get full account snapshot for a user ────────────────────────────────────
async function syncAccount(user) {
  const decKey = decryptKey(user.binanceApiKey || '');
  const decSecret = decryptKey(user.binanceApiSecret || '');
  if (!decKey || !decSecret) throw new Error('No API keys configured');

  const isFutures = user.accountType === 'futures';
  const client = buildClient(user.binanceApiKey, user.binanceApiSecret, user.accountType, user.binanceTestnet);

  const result = {
    balance: 0, availableBalance: 0, marginBalance: 0, walletBalance: 0,
    positions: [], openOrders: [], closedOrders: [], tradeHistory: [], pnl: 0,
    assets: []
  };

  try {
    if (isFutures) {
      const acct = await client.getAccount();
      result.balance = parseFloat(acct.totalWalletBalance || 0);
      result.availableBalance = parseFloat(acct.availableBalance || 0);
      result.marginBalance = parseFloat(acct.totalMarginBalance || 0);
      result.walletBalance = parseFloat(acct.totalWalletBalance || 0);
      result.pnl = parseFloat(acct.totalUnrealizedProfit || 0);
      result.assets = (acct.assets || []).filter(a => parseFloat(a.walletBalance) > 0);

      const positions = await client.getPositions();
      result.positions = positions.filter(p => parseFloat(p.positionAmt) !== 0).map(p => ({
        symbol: p.symbol,
        side: parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT',
        entryPrice: parseFloat(p.entryPrice),
        markPrice: parseFloat(p.markPrice),
        quantity: Math.abs(parseFloat(p.positionAmt)),
        leverage: parseInt(p.leverage),
        liquidationPrice: parseFloat(p.liquidationPrice),
        unrealizedPnl: parseFloat(p.unRealizedProfit),
        marginType: p.marginType,
        positionSide: p.positionSide,
        notional: Math.abs(parseFloat(p.notional)),
        roe: parseFloat(p.percentage || 0),
      }));
    } else {
      const acct = await client.getAccount();
      const usdt = (acct.balances || []).find(b => b.asset === 'USDT');
      result.balance = parseFloat(usdt?.free || 0) + parseFloat(usdt?.locked || 0);
      result.availableBalance = parseFloat(usdt?.free || 0);
      result.walletBalance = result.balance;
      result.assets = (acct.balances || []).filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0);
    }

    result.openOrders = await client.getOpenOrders();
  } catch (err) {
    throw new Error(`Binance sync failed: ${err.message}`);
  }

  return result;
}

// ── Place auto trade ─────────────────────────────────────────────────────────
async function placeTrade(user, signal) {
  const client = buildClient(user.binanceApiKey, user.binanceApiSecret, user.accountType, user.binanceTestnet);
  const side = signal.direction === 'BUY' ? 'BUY' : 'SELL';

  const params = {
    symbol: signal.symbol,
    side,
    type: 'LIMIT',
    timeInForce: 'GTC',
    quantity: signal.quantity,
    price: signal.entry.toFixed(signal.pricePrecision || 2),
  };

  if (user.accountType === 'futures') {
    if (signal.leverage) await client.setLeverage(signal.symbol, signal.leverage);
    params.positionSide = 'BOTH';
  }

  return client.placeOrder(params);
}

// ── Close partial / full position ────────────────────────────────────────────
async function closePosition(user, symbol, percent = 100, side = 'SELL') {
  const client = buildClient(user.binanceApiKey, user.binanceApiSecret, user.accountType, user.binanceTestnet);
  if (user.accountType === 'futures') {
    const positions = await client.getPositions();
    const pos = positions.find(p => p.symbol === symbol && parseFloat(p.positionAmt) !== 0);
    if (!pos) throw new Error('Position not found');
    const qty = (Math.abs(parseFloat(pos.positionAmt)) * percent / 100).toFixed(3);
    const closeSide = parseFloat(pos.positionAmt) > 0 ? 'SELL' : 'BUY';
    return client.placeOrder({ symbol, side: closeSide, type: 'MARKET', quantity: qty, reduceOnly: true, positionSide: 'BOTH' });
  }
  return client.placeOrder({ symbol, side, type: 'MARKET', quantity: '0' });
}

// ── Public market data (no auth) ─────────────────────────────────────────────
async function getPublicTickers() {
  const res = await axios.get(`${config.BINANCE.REST_BASE}/api/v3/ticker/24hr`, { timeout: 10000 });
  return res.data.filter(t => t.symbol.endsWith('USDT'));
}

async function getKlines(symbol, interval, limit = 200, futures = false) {
  const base = futures ? config.BINANCE.FUTURES_REST_BASE : config.BINANCE.REST_BASE;
  const endpoint = futures ? '/fapi/v1/klines' : '/api/v3/klines';
  const res = await axios.get(`${base}${endpoint}`, { params: { symbol, interval, limit }, timeout: 10000 });
  return res.data;
}

async function getFuturesExchangeInfo() {
  const res = await axios.get(`${config.BINANCE.FUTURES_REST_BASE}/fapi/v1/exchangeInfo`, { timeout: 10000 });
  return res.data;
}

module.exports = { buildClient, syncAccount, placeTrade, closePosition, getPublicTickers, getKlines, getFuturesExchangeInfo, encryptKey, decryptKey };
