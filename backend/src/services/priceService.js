const axios = require('axios');
const NodeCache = require('node-cache');
const { pool } = require('../db/schema');

const cache = new NodeCache({ stdTTL: 300 }); // 5 min in-memory cache

const EXCHANGE_SUFFIXES = {
  LSE: '.L',
  NYSE: '',
  NASDAQ: '',
  TSX: '.TO',
  ASX: '.AX',
  XETRA: '.DE',
  EURONEXT: '.PA',
  NSE: '.NS',
  BSE: '.BO',
  SET: '.BK',
  MAI: '.BK',
  SGX: '.SI',
  HKEX: '.HK',
  SZSE: '.SZ',
  SSE: '.SS',
  KRX: '.KS',
  TSE: '.T',
};

function buildYahooTicker(ticker, exchange) {
  const suffix = EXCHANGE_SUFFIXES[exchange?.toUpperCase()] ?? '';
  return `${ticker}${suffix}`;
}

async function fetchFromYahoo(ticker, exchange) {
  const symbol = buildYahooTicker(ticker, exchange);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
  const response = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 8000,
  });
  const result = response.data?.chart?.result?.[0];
  if (!result) throw new Error('No data from Yahoo Finance');
  const price = result.meta?.regularMarketPrice;
  const currency = result.meta?.currency || 'USD';
  if (!price) throw new Error('Price unavailable');
  return { price, currency, source: 'yahoo' };
}

async function fetchLivePrice(ticker, exchange) {
  const cacheKey = `${ticker}:${exchange}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const data = await fetchFromYahoo(ticker, exchange);
    cache.set(cacheKey, data);

    // Upsert into DB
    await pool.query(`
      INSERT INTO live_prices (ticker, exchange, price, currency, source, fetched_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (ticker, exchange) DO UPDATE SET
        price = EXCLUDED.price,
        currency = EXCLUDED.currency,
        source = EXCLUDED.source,
        fetched_at = NOW()
    `, [ticker, exchange, data.price, data.currency, data.source]);

    return data;
  } catch (err) {
    // Fall back to last known DB price
    const result = await pool.query(
      'SELECT price, currency, source, fetched_at FROM live_prices WHERE ticker = $1 AND exchange = $2',
      [ticker, exchange]
    );
    if (result.rows.length) return { ...result.rows[0], stale: true };
    throw new Error(`Price fetch failed: ${err.message}`);
  }
}

// Called by the background job to pre-warm prices for all tracked tickers
async function refreshAllPrices() {
  try {
    const result = await pool.query('SELECT DISTINCT ticker, exchange FROM transactions');
    const tickers = result.rows;
    cache.flushAll(); // force re-fetch from Yahoo, not cache
    await Promise.allSettled(tickers.map(({ ticker, exchange }) => fetchLivePrice(ticker, exchange)));
    console.log(`[price-refresh] Updated ${tickers.length} tickers at ${new Date().toISOString()}`);
  } catch (err) {
    console.error('[price-refresh] Error:', err.message);
  }
}

module.exports = { fetchLivePrice, refreshAllPrices };
