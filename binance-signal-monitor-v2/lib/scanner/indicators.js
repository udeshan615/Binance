/**
 * Technical indicators preserved from original scanner.
 */

export function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

export function findSwings(candles, left = 3, right = 3) {
  const swings = [];
  for (let i = left; i < candles.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= left; j++) {
      if (candles[i].high <= candles[i - j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low) isLow = false;
    }
    for (let j = 1; j <= right; j++) {
      if (candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i + j].low) isLow = false;
    }
    if (isHigh)
      swings.push({
        i,
        type: 'H',
        price: candles[i].high,
        time: candles[i].time,
      });
    if (isLow)
      swings.push({
        i,
        type: 'L',
        price: candles[i].low,
        time: candles[i].time,
      });
  }
  return swings;
}

export function calcEMA(candles, period) {
  if (candles.length < period) return null;
  const k = 2 / (period + 1);
  let ema = avg(candles.slice(0, period).map((c) => c.close));
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
  }
  return ema;
}

export function calcRSI(candles, period = 14) {
  if (candles.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close;
    if (d >= 0) gains += d;
    else losses -= d;
  }
  const rs = gains / (losses || 0.0001);
  return 100 - 100 / (1 + rs);
}

/** Simple ATR (Average True Range) on given candles */
export function calcATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
    trs.push(tr);
  }
  if (trs.length < period) return avg(trs);
  return avg(trs.slice(-period));
}

export function relativeVolume(candles) {
  if (candles.length < 20) return 1;
  const recent = candles.slice(-5).map((c) => c.volume);
  const past = candles.slice(-25, -5).map((c) => c.volume);
  return avg(recent) / (avg(past) || 1);
}

export function premiumDiscount(candles) {
  const last50 = candles.slice(-50);
  const hi = Math.max(...last50.map((c) => c.high));
  const lo = Math.min(...last50.map((c) => c.low));
  const mid = (hi + lo) / 2;
  const price = candles[candles.length - 1].close;
  const pos = (price - lo) / (hi - lo || 1);
  return {
    high: hi,
    low: lo,
    eq: mid,
    zone: pos > 0.6 ? 'PREMIUM' : pos < 0.4 ? 'DISCOUNT' : 'EQUILIBRIUM',
    pos,
  };
}
