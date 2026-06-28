const fs = require('fs');
const path = require('path');
const config = require('./config');

// ── helpers ──────────────────────────────────────────────────────────────────
function readJSON(file) {
  try {
    if (!fs.existsSync(file)) { fs.writeFileSync(file, '[]'); return []; }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return []; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function readJSONObj(file, def = {}) {
  try {
    if (!fs.existsSync(file)) { fs.writeFileSync(file, JSON.stringify(def, null, 2)); return def; }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return def; }
}
function writeJSONObj(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── USERS ────────────────────────────────────────────────────────────────────
const USERS_FILE = config.DB.PATH.USERS;
function getUsers() { return readJSON(USERS_FILE); }
function saveUsers(users) { writeJSON(USERS_FILE, users); }
function addUser(user) {
  const users = getUsers();
  users.push(user);
  saveUsers(users);
}
function getUserById(id) { return getUsers().find(u => u.id === id) || null; }
function updateUser(id, updater) {
  const users = getUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return false;
  updater(users[idx]);
  saveUsers(users);
  return true;
}
function deleteUser(id) {
  const users = getUsers().filter(u => u.id !== id);
  saveUsers(users);
}

// ── TRADES ───────────────────────────────────────────────────────────────────
const TRADES_FILE = config.DB.PATH.TRADES;
function getTrades() { return readJSON(TRADES_FILE); }
function saveTrades(trades) { writeJSON(TRADES_FILE, trades); }
function addTrade(trade) {
  const trades = getTrades();
  trades.push(trade);
  saveTrades(trades);
}
function getTradesByUser(userId) { return getTrades().filter(t => t.userId === userId); }
function updateTrade(id, updater) {
  const trades = getTrades();
  const idx = trades.findIndex(t => t.id === id);
  if (idx === -1) return false;
  updater(trades[idx]);
  saveTrades(trades);
  return true;
}
function deleteTrade(id) {
  const trades = getTrades().filter(t => t.id !== id);
  saveTrades(trades);
}

// ── SIGNALS ──────────────────────────────────────────────────────────────────
const SIGNALS_FILE = config.DB.PATH.SIGNALS;
function getSignals() { return readJSON(SIGNALS_FILE); }
function saveSignals(s) { writeJSON(SIGNALS_FILE, s); }
function addSignal(signal) {
  const signals = getSignals();
  signals.unshift(signal);
  if (signals.length > 500) signals.length = 500;
  saveSignals(signals);
}
function getSignalsBySymbol(symbol) { return getSignals().filter(s => s.symbol === symbol); }

// ── ADMIN ────────────────────────────────────────────────────────────────────
const ADMIN_FILE = config.DB.PATH.ADMIN;
function getAdmin() { return readJSONObj(ADMIN_FILE, {}); }
function updateAdmin(updater) {
  const admin = getAdmin();
  updater(admin);
  writeJSONObj(ADMIN_FILE, admin);
}

// ── DATABASE (global stats) ──────────────────────────────────────────────────
const DB_FILE = config.DB.PATH.DATABASE;
function getDatabase() { return readJSONObj(DB_FILE, {}); }
function updateGlobalStats(patch) {
  const db = getDatabase();
  Object.assign(db.stats, patch);
  writeJSONObj(DB_FILE, db);
}
function getGlobalSettings() {
  const db = getDatabase();
  const admin = getAdmin();
  return { ...db.settings, ...admin.settings };
}
function updateGlobalSettings(patch) {
  updateAdmin(a => { a.settings = { ...a.settings, ...patch }; });
}

// ── LOG ──────────────────────────────────────────────────────────────────────
function addLog(entry) {
  updateAdmin(a => {
    if (!a.logs) a.logs = [];
    a.logs.unshift({ ...entry, time: new Date().toISOString() });
    if (a.logs.length > 200) a.logs.length = 200;
  });
}

// ── BACKUP ───────────────────────────────────────────────────────────────────
function backup() {
  const dir = './backups';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const files = [USERS_FILE, TRADES_FILE, SIGNALS_FILE, ADMIN_FILE, DB_FILE];
  files.forEach(f => {
    if (fs.existsSync(f)) {
      const dest = path.join(dir, `${path.basename(f, '.json')}-${ts}.json`);
      fs.copyFileSync(f, dest);
    }
  });
  // Keep only last 10 backups per type
  const all = fs.readdirSync(dir);
  ['users', 'trades', 'signals', 'admin', 'database'].forEach(type => {
    const typeFiles = all.filter(f => f.startsWith(type + '-')).sort();
    while (typeFiles.length > 10) {
      fs.unlinkSync(path.join(dir, typeFiles.shift()));
    }
  });
}

module.exports = {
  getUsers, saveUsers, addUser, getUserById, updateUser, deleteUser,
  getTrades, saveTrades, addTrade, getTradesByUser, updateTrade, deleteTrade,
  getSignals, saveSignals, addSignal, getSignalsBySymbol,
  getAdmin, updateAdmin,
  getDatabase, updateGlobalStats, getGlobalSettings, updateGlobalSettings,
  addLog, backup
};
