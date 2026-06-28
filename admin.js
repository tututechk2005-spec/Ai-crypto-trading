const bcrypt = require('bcryptjs');
const db = require('./db');
const { publicUser } = require('./auth');

// ── Dashboard stats ───────────────────────────────────────────────────────────
function getDashboardStats() {
  const users = db.getUsers();
  const trades = db.getTrades();
  const signals = db.getSignals();
  const today = new Date().toDateString();

  return {
    totalUsers: users.length,
    premiumUsers: users.filter(u => u.isPremium).length,
    activeUsers: users.filter(u => u.isActive && !u.isBanned).length,
    bannedUsers: users.filter(u => u.isBanned).length,
    totalTrades: trades.length,
    openTrades: trades.filter(t => t.status === 'open').length,
    todayTrades: trades.filter(t => new Date(t.openedAt).toDateString() === today).length,
    totalSignals: signals.length,
    todaySignals: signals.filter(s => new Date(s.generatedAt).toDateString() === today).length,
    totalRevenue: users.reduce((sum, u) => sum + (u.paidAmount || 0), 0),
    totalReferralEarnings: users.reduce((sum, u) => sum + (u.referralEarnings || 0), 0),
  };
}

// ── User management ───────────────────────────────────────────────────────────
function getAllUsers() {
  return db.getUsers().map(u => {
    const { passwordHash, binanceApiSecret, ...safe } = u;
    return safe;
  });
}

function getUser(userId) {
  const u = db.getUserById(userId);
  if (!u) return null;
  const { passwordHash, binanceApiSecret, ...safe } = u;
  return safe;
}

function approveUser(userId) {
  db.updateUser(userId, u => { u.isActive = true; u.isBanned = false; });
  db.addLog({ type: 'admin', action: 'approve', userId });
}

function banUser(userId) {
  db.updateUser(userId, u => { u.isBanned = true; });
  db.addLog({ type: 'admin', action: 'ban', userId });
}

function unbanUser(userId) {
  db.updateUser(userId, u => { u.isBanned = false; });
  db.addLog({ type: 'admin', action: 'unban', userId });
}

function deleteUser(userId) {
  db.deleteUser(userId);
  db.addLog({ type: 'admin', action: 'delete', userId });
}

async function resetPassword(userId, newPassword) {
  const hash = await bcrypt.hash(newPassword, 12);
  db.updateUser(userId, u => { u.passwordHash = hash; });
  db.addLog({ type: 'admin', action: 'reset_password', userId });
}

function resetStats(userId) {
  db.updateUser(userId, u => {
    u.stats = {
      totalTrades: 0, winTrades: 0, lossTrades: 0, breakevenTrades: 0,
      totalProfit: 0, totalLoss: 0, netProfit: 0, lifetimeProfit: 0,
      todayProfit: 0, weekProfit: 0, monthProfit: 0, winRate: 0,
      avgRR: 0, avgHoldTime: 0, largestWin: 0, largestLoss: 0,
      recoveryMode: false, recoveryLossCount: 0, dailyLossTotal: 0, dailyLossDate: null
    };
  });
  db.addLog({ type: 'admin', action: 'reset_stats', userId });
}

// ── Subscription management ───────────────────────────────────────────────────
function setSubscription(userId, { plan, days, months, years, isPremium, amount }) {
  db.updateUser(userId, u => {
    const now = new Date();
    const expiry = new Date(now);
    if (days) expiry.setDate(expiry.getDate() + parseInt(days));
    if (months) expiry.setMonth(expiry.getMonth() + parseInt(months));
    if (years) expiry.setFullYear(expiry.getFullYear() + parseInt(years));

    u.subscriptionPlan = plan || u.subscriptionPlan;
    u.subscriptionExpiry = expiry.toISOString();
    u.isPremium = isPremium !== undefined ? isPremium : true;
    if (amount) u.paidAmount = (u.paidAmount || 0) + parseFloat(amount);
  });
  db.addLog({ type: 'admin', action: 'set_subscription', userId, plan, days, months, years });
}

// ── Admin settings ────────────────────────────────────────────────────────────
function getSettings() {
  return db.getGlobalSettings();
}

function updateSettings(settings) {
  db.updateGlobalSettings(settings);
  db.addLog({ type: 'admin', action: 'update_settings' });
}

// ── Logs ──────────────────────────────────────────────────────────────────────
function getLogs(limit = 100) {
  const admin = db.getAdmin();
  return (admin.logs || []).slice(0, limit);
}

// ── Signal management ─────────────────────────────────────────────────────────
function getAdminSignals(limit = 100) {
  return db.getSignals().slice(0, limit);
}

// ── Revenue ───────────────────────────────────────────────────────────────────
function getRevenue() {
  const users = db.getUsers();
  return users
    .filter(u => u.paidAmount > 0)
    .map(u => ({ userId: u.id, username: u.username, amount: u.paidAmount, plan: u.subscriptionPlan, expiry: u.subscriptionExpiry }));
}

// ── Referral stats ────────────────────────────────────────────────────────────
function getReferralStats() {
  const users = db.getUsers();
  return users
    .filter(u => u.referrals && u.referrals.length > 0)
    .map(u => ({ userId: u.id, username: u.username, referrals: u.referrals.length, earnings: u.referralEarnings || 0 }));
}

module.exports = {
  getDashboardStats, getAllUsers, getUser, approveUser, banUser, unbanUser,
  deleteUser, resetPassword, resetStats, setSubscription,
  getSettings, updateSettings, getLogs, getAdminSignals, getRevenue, getReferralStats
};
