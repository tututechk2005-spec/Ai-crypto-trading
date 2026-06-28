const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const db = require('./db');

// Generate JWT token
function generateToken(payload) {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: '7d' });
}

// Verify JWT token middleware
function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const token = auth.split(' ')[1];
    req.user = jwt.verify(token, config.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Admin middleware
function verifyAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, config.JWT_SECRET);
    if (!decoded.isAdmin) return res.status(403).json({ error: 'Forbidden' });
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Register
async function register(req, res) {
  const { username, email, password, referralCode } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
  const users = db.getUsers();
  if (users.find(u => u.email === email)) return res.status(400).json({ error: 'Email already exists' });
  if (users.find(u => u.username === username)) return res.status(400).json({ error: 'Username taken' });

  const passwordHash = await bcrypt.hash(password, 12);
  const myReferralCode = uuidv4().substring(0, 8).toUpperCase();
  let referredBy = null;
  if (referralCode) {
    const referrer = users.find(u => u.referralCode === referralCode);
    if (referrer) referredBy = referrer.id;
  }

  const user = {
    id: uuidv4(),
    username,
    email,
    passwordHash,
    referralCode: myReferralCode,
    referredBy,
    referralEarnings: 0,
    referrals: [],
    isPremium: false,
    subscriptionExpiry: null,
    subscriptionPlan: 'free',
    binanceApiKey: null,
    binanceApiSecret: null,
    binanceTestnet: true,
    tradeMode: 'demo',
    accountType: 'spot',
    isActive: true,
    isBanned: false,
    createdAt: new Date().toISOString(),
    lastLogin: null,
    stats: {
      totalTrades: 0, winTrades: 0, lossTrades: 0, breakevenTrades: 0,
      totalProfit: 0, totalLoss: 0, netProfit: 0, lifetimeProfit: 0,
      todayProfit: 0, weekProfit: 0, monthProfit: 0, winRate: 0,
      avgRR: 0, avgHoldTime: 0, largestWin: 0, largestLoss: 0,
      recoveryMode: false, recoveryLossCount: 0, dailyLossTotal: 0,
      dailyLossDate: null
    }
  };

  db.addUser(user);

  // Credit referrer
  if (referredBy) {
    db.updateUser(referredBy, u => {
      u.referrals.push(user.id);
      u.referralEarnings += 0;
    });
  }

  db.updateGlobalStats({ totalUsers: db.getUsers().length });
  const token = generateToken({ id: user.id, username: user.username, email: user.email, isAdmin: false });
  res.json({ success: true, token, user: publicUser(user) });
}

// Login
async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const users = db.getUsers();
  const user = users.find(u => u.email === email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (user.isBanned) return res.status(403).json({ error: 'Account banned' });
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  db.updateUser(user.id, u => { u.lastLogin = new Date().toISOString(); });
  const token = generateToken({ id: user.id, username: user.username, email: user.email, isAdmin: false });
  res.json({ success: true, token, user: publicUser(user) });
}

// Admin login
async function adminLogin(req, res) {
  const { username, password } = req.body;
  const adminData = db.getAdmin();
  if (username !== adminData.username) return res.status(401).json({ error: 'Invalid credentials' });
  let valid = false;
  if (adminData.passwordHash) {
    valid = await bcrypt.compare(password, adminData.passwordHash);
  } else {
    valid = (password === config.ADMIN_PASSWORD);
    if (valid) {
      const hash = await bcrypt.hash(password, 12);
      db.updateAdmin(a => { a.passwordHash = hash; });
    }
  }
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  db.updateAdmin(a => { a.lastLogin = new Date().toISOString(); });
  const token = generateToken({ isAdmin: true, username });
  res.json({ success: true, token });
}

function publicUser(u) {
  const { passwordHash, binanceApiSecret, ...safe } = u;
  return safe;
}

module.exports = { register, login, adminLogin, verifyToken, verifyAdmin, generateToken, publicUser };
