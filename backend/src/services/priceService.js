const axios = require('axios');
const NodeCache = require('node-cache');
const { pool } = require('../db/schema');

const cache = new NodeCache({ stdTTL: 300 });

const EXCHANGE_SUFFIXES = {
  LSE: '.L', NYSE: '', NASDAQ: '', TSX: '.TO', ASX: '.AX',
  XETRA: '.DE', EURONEXT: '.PA', NSE: '.NS', BSE: '.BO',
  SET: '.BK', MAI: '.BK', SGX: '.SI', HKEX: '.HK',
  SZSE: '.SZ', SSE: '.SS', KRX: '.KS', TSE: '.T',
};

// Thai mutual fund exchanges
const THAI_MF_EXCHANGES = ['TH-MF', 'AIMC'];

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

async function fetchFromFinnhub(ticker, exchange) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) throw new Error('FINNHUB_API_KEY not set');
  const symbol = buildYahooTicker(ticker, exchange); // same suffix mapping works for Finnhub
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
  const response = await axios.get(url, { timeout: 8000 });
  const { c: price, pc } = response.data; // c = current price, pc = previous close
  if (!price || price === 0) throw new Error('Finnhub returned no price');
  // Finnhub doesn't return currency — derive from exchange
  const THB_EXCHANGES = ['SET', 'MAI'];
  const currency = THB_EXCHANGES.includes(exchange?.toUpperCase()) ? 'THB' : 'USD';
  return { price, currency, source: 'finnhub' };
}

// Fetch Thai mutual fund NAV from SEC Thailand public API
async function fetchThaiMutualFundNAV(fundCode) {
  // Try SEC Thailand API
  try {
    const url = `https://api.sec.or.th/FundFactsheet/fund/nav?LangCode=E&FundName=${encodeURIComponent(fundCode)}`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });
    const data = response.data;
    if (Array.isArray(data) && data.length > 0) {
      const latest = data[0];
      const price = parseFloat(latest.nav || latest.NAV || latest.navPerUnit || latest.NAVPerUnit);
      if (price && !isNaN(price)) {
        return { price, currency: 'THB', source: 'sec-thailand', navDate: latest.navDate || latest.NAVDate };
      }
    }
  } catch (e) {
    // fall through to AIMC
  }

  // Try AIMC (Thai Mutual Fund Association) as fallback
  try {
    const url = `https://www.thaimutualfund.com/overlay/FundDetailOverlay.aspx?id=${encodeURIComponent(fundCode)}`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });
    // Parse NAV from HTML response
    const match = response.data.match(/NAV[^0-9]*([0-9]+\.[0-9]+)/i);
    if (match) {
      return { price: parseFloat(match[1]), currency: 'THB', source: 'aimc' };
    }
  } catch (e) {
    // fall through
  }

  throw new Error(`NAV not found for fund: ${fundCode}. Use manual price override.`);
}

async function fetchLivePrice(ticker, exchange) {
  const cacheKey = `${ticker}:${exchange}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    let data;
    if (THAI_MF_EXCHANGES.includes(exchange?.toUpperCase())) {
      data = await fetchThaiMutualFundNAV(ticker);
    } else {
      // Try Yahoo Finance first; fall back to Finnhub if Yahoo fails
      try {
        data = await fetchFromYahoo(ticker, exchange);
      } catch (yahooErr) {
        console.warn(`[price] Yahoo failed for ${ticker} (${exchange}): ${yahooErr.message} — trying Finnhub`);
        data = await fetchFromFinnhub(ticker, exchange);
      }
    }

    cache.set(cacheKey, data);

    await pool.query(`
      INSERT INTO live_prices (ticker, exchange, price, currency, source, fetched_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (ticker, exchange) DO UPDATE SET
        price = EXCLUDED.price, currency = EXCLUDED.currency,
        source = EXCLUDED.source, fetched_at = NOW()
    `, [ticker, exchange, data.price, data.currency, data.source]);

    return data;
  } catch (err) {
    const result = await pool.query(
      'SELECT price, currency, source, fetched_at FROM live_prices WHERE ticker = $1 AND exchange = $2',
      [ticker, exchange]
    );
    if (result.rows.length) return { ...result.rows[0], stale: true };
    throw new Error(`Price fetch failed: ${err.message}`);
  }
}

async function refreshAllPrices() {
  try {
    const result = await pool.query('SELECT DISTINCT ticker, exchange, asset_type FROM transactions');
    const tickers = result.rows;
    cache.flushAll();
    await Promise.allSettled(tickers.map(({ ticker, exchange }) => fetchLivePrice(ticker, exchange)));
    console.log(`[price-refresh] Updated ${tickers.length} tickers at ${new Date().toISOString()}`);
  } catch (err) {
    console.error('[price-refresh] Error:', err.message);
  }
}

module.exports = { fetchLivePrice, refreshAllPrices, THAI_MF_EXCHANGES };
