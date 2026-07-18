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
  let price = result.meta?.regularMarketPrice;
  let currency = result.meta?.currency || 'USD';
  if (!price) throw new Error('Price unavailable');
  // LSE stocks are quoted in pence (GBp/GBX) — convert to pounds so it matches
  // GBP-denominated cost basis and other GBP prices in the portfolio.
  if (currency === 'GBp' || currency === 'GBX') {
    price = price / 100;
    currency = 'GBP';
  }
  return { price, currency, source: 'yahoo' };
}

async function fetchFromFinnhub(ticker, exchange) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) throw new Error('FINNHUB_API_KEY not set');
  const symbol = buildYahooTicker(ticker, exchange); // same suffix mapping works for Finnhub
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
  const response = await axios.get(url, { timeout: 8000 });
  let { c: price } = response.data; // c = current price
  if (!price || price === 0) throw new Error('Finnhub returned no price');
  // Finnhub doesn't return currency — derive from exchange
  const THB_EXCHANGES = ['SET', 'MAI'];
  let currency = THB_EXCHANGES.includes(exchange?.toUpperCase()) ? 'THB' : 'USD';
  if (exchange?.toUpperCase() === 'LSE') {
    // Finnhub returns LSE quotes in pence too — convert to pounds
    price = price / 100;
    currency = 'GBP';
  }
  return { price, currency, source: 'finnhub' };
}

// --- Thai mutual fund NAV: Finnomena fund list (code -> Morningstar ID) + Morningstar quote ---

// Aliases for fund codes entered differently from Finnomena's listing
const THAI_FUND_ALIASES = {
  'SCBWLD': 'SCBWORLD(A)',
  'K-GINFRA-A': 'K-GINFRA-A(D)',
};

// Known fund code -> Morningstar security ID (skips the Finnomena lookup,
// which is blocked from some datacenter IPs)
const THAI_FUND_MS_IDS = {
  'K-GINFRA-A': 'F00000X1H9',
  'KF-ACHINA-A': 'F0000107C7',
  'KFGPROP-A': 'F0000149I8',
  'KFHHCARE-A': 'F0000125CM',
  'KFINDIA-A': 'F00000ZIKF',
  'KFVIET-A': 'F000010F4S',
  'SCBNK225': 'F00000QJNM',
  'SCBWLD': 'F00001D493',
};

let thaiFundIndex = null;       // normalized short_code -> { id, short_code }
let thaiFundIndexFetchedAt = 0;
const FUND_INDEX_TTL = 24 * 60 * 60 * 1000; // refresh fund list daily

function normalizeFundCode(code) {
  return String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9,th;q=0.8',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

async function getThaiFundIndex() {
  if (thaiFundIndex && Date.now() - thaiFundIndexFetchedAt < FUND_INDEX_TTL) return thaiFundIndex;
  const response = await axios.get('https://www.finnomena.com/fn3/api/fund/public/list?page=1&size=20000', {
    headers: { ...BROWSER_HEADERS, Referer: 'https://www.finnomena.com/fund' },
    timeout: 30000,
  });
  const funds = response.data;
  if (!Array.isArray(funds) || funds.length === 0) throw new Error('Finnomena fund list unavailable');
  const index = {};
  for (const f of funds) {
    if (f.short_code && f.id) index[normalizeFundCode(f.short_code)] = { id: f.id, short_code: f.short_code };
  }
  thaiFundIndex = index;
  thaiFundIndexFetchedAt = Date.now();
  return index;
}

async function resolveThaiFundId(fundCode) {
  const upper = fundCode.toUpperCase();
  if (THAI_FUND_MS_IDS[upper]) return THAI_FUND_MS_IDS[upper];

  const aliased = THAI_FUND_ALIASES[upper] || fundCode;
  const index = await getThaiFundIndex();
  const norm = normalizeFundCode(aliased);
  if (index[norm]) return index[norm].id;
  // prefix match: user entered "K-GINFRA-A", listing has "K-GINFRA-A(D)"
  const prefixHit = Object.keys(index).find(k => k.startsWith(norm));
  if (prefixHit) return index[prefixHit].id;
  return null;
}

async function fetchThaiMutualFundNAV(fundCode) {
  const msId = await resolveThaiFundId(fundCode);
  if (!msId) throw new Error(`Fund code not found in Thai fund registry: ${fundCode}. Use manual price override.`);

  // Morningstar legacy timeseries endpoint — no auth, returns daily NAV history
  const startDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url = `https://tools.morningstar.it/api/rest.svc/timeseries_price/jbyiq3rhyf?currencyId=THB&idtype=Morningstar&frequency=daily&outputType=JSON&startDate=${startDate}&id=${msId}]2]0]FOTHA$$ALL`;
  const response = await axios.get(url, {
    headers: { ...BROWSER_HEADERS },
    timeout: 15000,
  });
  const history = response.data?.TimeSeries?.Security?.[0]?.HistoryDetail;
  if (!Array.isArray(history) || history.length === 0) {
    throw new Error(`NAV unavailable for ${fundCode} (${msId})`);
  }
  const latest = history[history.length - 1];
  const price = parseFloat(latest.Value);
  if (!price || isNaN(price)) throw new Error(`NAV unavailable for ${fundCode} (${msId})`);
  return { price, currency: 'THB', source: 'morningstar', navDate: latest.EndDate };
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
