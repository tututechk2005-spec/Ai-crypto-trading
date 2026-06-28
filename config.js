require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'crypto_trading_secret_key_change_in_production',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'crypto_enc_key_32chars_change_now',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',

  BINANCE: {
    REST_BASE: 'https://api.binance.com',
    FUTURES_REST_BASE: 'https://fapi.binance.com',
    WS_BASE: 'wss://stream.binance.com:9443',
    FUTURES_WS_BASE: 'wss://fstream.binance.com',
    TESTNET_REST: 'https://testnet.binance.vision',
    TESTNET_FUTURES_REST: 'https://testnet.binancefuture.com',
  },

  RISK: {
    DEFAULT_RISK_PERCENT: 1,
    MAX_OPEN_TRADES: 5,
    MIN_RR: 2,
    DAILY_LOSS_LIMIT_PERCENT: 5,
    RECOVERY_LOSSES_TRIGGER: 3,
    RECOVERY_MIN_SCORE: 85,
    RECOVERY_MIN_RR: 2,
    TRAILING_STEP: 0.5,
  },

  SIGNALS: {
    MIN_CONFIDENCE: 90,
    COOLDOWN_MINUTES: 30,
    MAX_SIGNALS_PER_DAY: 20,
    SCAN_INTERVAL_MS: 60000,
  },

  SCANNER: {
    TIMEFRAMES: ['4h', '1h', '15m'],
    PRIMARY_TIMEFRAME: '4h',
    CONFIRM_TIMEFRAME: '1h',
    ENTRY_TIMEFRAME: '15m',
    MIN_VOLUME_USDT: 1000000,
    MAX_SYMBOLS: 100,
  },

  DB: {
    BACKUP_INTERVAL_MINUTES: 30,
    PATH: {
      USERS: './users.json',
      TRADES: './trades.json',
      SIGNALS: './signals.json',
      ADMIN: './admin.json',
      DATABASE: './database.json',
    }
  }
};
