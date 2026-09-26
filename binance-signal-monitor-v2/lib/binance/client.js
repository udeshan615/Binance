/**
 * Binance Futures public API client with retries & rate-limit handling.
 */
import { SIGNAL_CONFIG } from '../config/signalConfig.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchJSON(url, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, {
        headers: { Accept: 'application/json' },
        next: { revalidate: 0 },
      });
      if (r.status === 429) {
        await sleep(600 * (i + 1));
        continue;
      }
      if (r.status === 451) {
        // Geo-block is not transient — retrying won't help, fail fast.
        throw new Error(
          'HTTP 451: Binance is geo-blocking this server\'s region. Set "regions" in vercel.json to a non-US region (e.g. sin1) and redeploy.'
        );
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === retries - 1 || e.message.startsWith('HTTP 451')) throw e;
      await sleep(400 * (i + 1));
    }
  }
}

export async function loadExchangeInfo() {
  const base = SIGNAL_CONFIG.binanceBaseUrl;
  const data = await fetchJSON(`${base}/fapi/v1/exchangeInfo`);
  return data.symbols
    .filter(
      (s) =>
        s.contractType === 'PERPETUAL' &&
        s.quoteAsset === 'USDT' &&
        s.status === 'TRADING'
    )
    .map((s) => s.symbol);
}

export async function loadTickers() {
  const base = SIGNAL_CONFIG.binanceBaseUrl;
  const data = await fetchJSON(`${base}/fapi/v1/ticker/24hr`);
  const map = {};
  for (const t of data) {
    if (t.symbol?.endsWith('USDT')) {
      map[t.symbol] = {
        price: +t.lastPrice,
        change: +t.priceChangePercent,
        volume: +t.quoteVolume,
        high: +t.highPrice,
        low: +t.lowPrice,
      };
    }
  }
  return map;
}

/** Simple in-memory cache for klines (per serverless invocation) */
const klineCache = new Map();

export async function getKlines(symbol, interval, limit = 150) {
  const key = `${symbol}_${interval}_${limit}`;
  const now = Date.now();
  const cached = klineCache.get(key);
  if (cached && now - cached.ts < SIGNAL_CONFIG.klineCacheMs) {
    return cached.data;
  }
  const base = SIGNAL_CONFIG.binanceBaseUrl;
  const url = `${base}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const raw = await fetchJSON(url);
  const candles = raw.map((c) => ({
    time: Math.floor(c[0] / 1000),
    open: +c[1],
    high: +c[2],
    low: +c[3],
    close: +c[4],
    volume: +c[5],
    closed: true,
  }));
  klineCache.set(key, { data: candles, ts: now });
  return candles;
}

export function clearKlineCache() {
  klineCache.clear();
}
