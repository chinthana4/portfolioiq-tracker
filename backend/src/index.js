require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { initSchema } = require('./db/schema');
const authRoutes        = require('./routes/auth');
const platformRoutes    = require('./routes/platforms');
const transactionRoutes = require('./routes/transactions');
const salesRoutes       = require('./routes/sales');
const priceRoutes       = require('./routes/prices');
const { refreshAllPrices } = require('./services/priceService');

const app  = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3000']
  : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

app.use('/api/auth',         authRoutes);
app.use('/api/platforms',    platformRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/sales',        salesRoutes);
app.use('/api/prices',       priceRoutes);

app.get('/api/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Serve built frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../frontend/dist')));
  app.get('*', (_, res) => res.sendFile(path.join(__dirname, '../../frontend/dist/index.html')));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  await initSchema();
  app.listen(PORT, () => console.log(`API running on port ${PORT}`));

  // Background price refresh every 5 minutes
  const REFRESH_INTERVAL = 5 * 60 * 1000;
  await refreshAllPrices(); // warm up on boot
  setInterval(refreshAllPrices, REFRESH_INTERVAL);
  console.log(`[price-refresh] Auto-refresh every ${REFRESH_INTERVAL / 60000} minutes`);
}

start().catch(err => { console.error('Startup failed:', err); process.exit(1); });
