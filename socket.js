const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');
const { syncUserAccount } = require('./sync');

let io = null;

function initSocket(server) {
  io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  });

  // Auth middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) { socket.isGuest = true; return next(); }
    try {
      socket.user = jwt.verify(token, config.JWT_SECRET);
      socket.isGuest = false;
    } catch {
      socket.isGuest = true;
    }
    next();
  });

  io.on('connection', (socket) => {
    const uid = socket.user?.id || 'guest';
    console.log(`[SOCKET] Connected: ${uid}`);

    // Send cached signals on connect
    const recent = db.getSignals().slice(0, 20);
    socket.emit('recentSignals', recent);

    // Join personal room if authenticated
    if (!socket.isGuest && socket.user?.id) {
      socket.join(`user:${socket.user.id}`);
    }

    // Subscribe to market updates
    socket.on('subscribeMarket', () => {
      socket.join('market');
    });

    // Manual trade updates (for live PNL)
    socket.on('requestTrades', () => {
      if (socket.isGuest || !socket.user?.id) return;
      const trades = db.getTradesByUser(socket.user.id).filter(t => t.status === 'open');
      socket.emit('openTrades', trades);
    });

    // Request account sync
    socket.on('syncAccount', async () => {
      if (socket.isGuest || !socket.user?.id) return;
      try {
        const data = await syncUserAccount(socket.user.id);
        socket.emit('accountSynced', { success: true, data });
      } catch (err) {
        socket.emit('accountSynced', { success: false, error: err.message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[SOCKET] Disconnected: ${uid}`);
    });
  });

  return io;
}

function getIO() { return io; }

// Broadcast to a specific user
function emitToUser(userId, event, data) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
}

// Broadcast to all
function broadcast(event, data) {
  if (!io) return;
  io.emit(event, data);
}

// Broadcast market data to subscribers
function broadcastMarket(data) {
  if (!io) return;
  io.to('market').emit('marketTickers', data);
}

module.exports = { initSocket, getIO, emitToUser, broadcast, broadcastMarket };
