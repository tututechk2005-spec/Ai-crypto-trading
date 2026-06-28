# ⚡ AI Crypto Auto Trading Platform

A production-ready AI-powered crypto trading platform with Smart Money Concept signals, automated Binance trading, and a premium dark UI.

## Features

- 🎯 **SMC Signals** — BOS, CHoCH, Order Blocks, FVG, Liquidity Sweep (90%+ confidence only)
- 🤖 **Auto Trading** — Binance Spot & Futures with smart risk management
- 🌐 **Live Market** — All USDT pairs with real-time WebSocket data
- 🛡️ **Risk Engine** — ATR SL, Dynamic sizing, Recovery Mode, Daily loss protection
- 📊 **Trade Management** — Close 25/50/75/100%, Move SL/TP, Break Even, Trailing Stop
- 👤 **User System** — JWT auth, referral system, subscription management
- 🔐 **Admin Panel** — Full user management, revenue, logs, settings
- ⚡ **Instant Sync** — Import all Binance positions, orders, history on connect

## Quick Start

\`\`\`bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your values

# Start server
npm start
\`\`\`

Visit: `http://localhost:3000`

## Project Structure

\`\`\`
/
├── server.js          # Main Express server + routes
├── config.js          # All configuration
├── db.js              # JSON database layer
├── auth.js            # JWT authentication
├── binance.js         # Binance API integration
├── strategy.js        # SMC signal engine
├── scanner.js         # Market scanner
├── sync.js            # Account sync
├── risk.js            # Risk management
├── referral.js        # Referral system
├── admin.js           # Admin functions
├── socket.js          # WebSocket (Socket.IO)
├── users.json         # User database
├── trades.json        # Trade database
├── signals.json       # Signal database
├── admin.json         # Admin config
├── render.yaml        # Render deployment config
└── public/
    ├── index.html     # Landing page
    ├── login.html     # Login
    ├── register.html  # Register
    ├── dashboard.html # Main app (all pages)
    ├── admin.html     # Admin panel
    ├── css/style.css  # Dark theme styles
    └── js/app.js      # Frontend JavaScript
\`\`\`

## Deploy to Render

1. Push to GitHub
2. Connect repo to [render.com](https://render.com)
3. Use `render.yaml` for automatic config
4. Set `ADMIN_PASSWORD` in Render environment variables

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Server port | `3000` |
| `JWT_SECRET` | JWT signing secret | Change in production! |
| `ENCRYPTION_KEY` | AES key for API keys | Change in production! |
| `ADMIN_USERNAME` | Admin login username | `admin` |
| `ADMIN_PASSWORD` | Admin login password | `admin123` |

## Security Notes

- Change `JWT_SECRET` and `ENCRYPTION_KEY` before deploying to production
- Binance API keys are AES-256 encrypted in the database
- Passwords are bcrypt hashed (12 rounds)
- Rate limiting: 200 requests per 15 minutes per IP
- Helmet.js security headers enabled

## Admin Panel

Access at `/admin.html` — default credentials:
- Username: `admin`
- Password: `admin123` (change immediately!)

## Signal Logic

Signals are generated using Smart Money Concepts:
- **4H + 1H trend alignment** (EMA 20/50/200)
- **Break of Structure (BOS)** detection
- **Change of Character (CHoCH)** detection
- **Order Block** identification
- **Fair Value Gap (FVG)** detection
- **Liquidity Sweep** detection
- **Volume Spike** confirmation
- **RSI** (45–70 for longs, 30–55 for shorts)
- **VWAP** position confirmation
- **ATR-based** SL/TP levels (min RR 1:2)
- Minimum **90% confidence** score required
- **Per-symbol cooldown** (never blocks other symbols)

## Risk Management

- Default 1% risk per trade
- ATR-based dynamic stop loss
- Minimum 1:2 Risk/Reward ratio
- Maximum configurable open trades
- Daily loss limit protection
- Recovery Mode (higher confirmation required after losses)
- Cooldown per symbol (spot/futures independent)

## License

MIT — Use freely, deploy commercially.
