/**
 * Scoring logic preserved from original scanner.
 * Do not arbitrarily change weights.
 */
import { detectStructure } from './structure.js';
import { detectOrderBlocks } from './orderBlocks.js';
import { detectFVGs } from './fvg.js';
import { detectLiquidity } from './liquidity.js';
import {
  findSwings,
  relativeVolume,
  premiumDiscount,
  calcEMA,
  calcRSI,
} from './indicators.js';
import { SIGNAL_CONFIG } from '../config/signalConfig.js';

export function scoreSetup(symbol, htfCandles, obCandles, entryStyle, threshold, price, opts = {}) {
  const includeAll = !!opts.includeAll;
  const htfStruct = detectStructure(htfCandles);
  const obs = detectOrderBlocks(obCandles);
  const fvgs = detectFVGs(obCandles);
  const swings = findSwings(obCandles);
  const liq = detectLiquidity(obCandles, swings);
  const pd = premiumDiscount(obCandles);
  const rvol = relativeVolume(obCandles);
  const ema20 = calcEMA(obCandles, 20);
  const rsi = calcRSI(obCandles);

  const results = [];
  const style = entryStyle || SIGNAL_CONFIG.entryStyle;
  const minScore = threshold ?? SIGNAL_CONFIG.minScore;

  for (const ob of obs) {
    if (ob.status === 'INVALIDATED') continue;

    // LONG
    if (ob.type === 'bullish') {
      let score = 0;
      const conf = [];

      if (htfStruct.bias === 'bullish' || htfStruct.bos === 'bullish') {
        score += 15;
        conf.push('HTF Bullish');
      } else if (htfStruct.choch === 'bullish') {
        score += 10;
        conf.push('HTF CHOCH↑');
      } else if (htfStruct.bias === 'neutral') score += 5;

      score += Math.min(20, ob.strength * 0.2);
      conf.push(`OB ${ob.status} (${ob.strength.toFixed(0)})`);

      let liqScore = 0;
      if (liq.sellSide && price > liq.sellSide * 0.998) {
        liqScore = 12;
        conf.push('Near Sell-side Liq');
      }
      if (liq.equalLows.length) {
        liqScore = Math.max(liqScore, 8);
        conf.push('Equal Lows');
      }
      score += liqScore;

      if (htfStruct.bos === 'bullish' || htfStruct.choch === 'bullish') {
        score += 15;
        conf.push('Bullish BOS/CHOCH');
      } else if (htfStruct.bias === 'bullish') score += 8;

      const nearFVG = fvgs.find(
        (f) => f.type === 'bullish' && f.low <= ob.high && f.high >= ob.low
      );
      if (nearFVG) {
        score += 10;
        conf.push('FVG overlap');
      } else if (fvgs.some((f) => f.type === 'bullish' && f.status === 'OPEN')) {
        score += 5;
        conf.push('Bullish FVG');
      }

      if (ob.displacement > 0) {
        score += Math.min(10, ob.displacement * 2);
        conf.push('Displacement');
      }
      if (ob.volumeExp || rvol > 1.4) {
        score += 5;
        conf.push('Vol expansion');
      } else if (rvol > 1.1) score += 2;

      if (pd.zone === 'DISCOUNT') {
        score += 5;
        conf.push('Discount');
      } else if (pd.zone === 'EQUILIBRIUM') score += 2;

      if (ema20 && price > ema20) {
        score += 3;
        conf.push('Above EMA20');
      }
      if (rsi > 45 && rsi < 70) score += 2;
      score += 3;
      score = Math.min(100, Math.round(score));

      if (includeAll || score >= minScore) {
        const entry =
          style === 'aggressive'
            ? ob.mid
            : style === 'conservative'
              ? ob.low + (ob.high - ob.low) * 0.3
              : ob.low + (ob.high - ob.low) * 0.4;
        const sl = ob.low * 0.9985;
        const risk = entry - sl;
        const tp1 = entry + risk * 1.8;
        const tp2 = entry + risk * 3.0;
        const tp3 = entry + risk * 4.5;
        const rr = risk > 0 ? ((tp1 - entry) / risk).toFixed(1) : '—';

        results.push({
          symbol,
          dir: 'LONG',
          score,
          qualifies: score >= minScore,
          conf,
          ob,
          fvgs: nearFVG ? [nearFVG] : [],
          liq,
          structure: htfStruct,
          pd,
          rvol,
          entry,
          sl,
          tp1,
          tp2,
          tp3,
          rr,
          price,
        });
      }
    }

    // SHORT
    if (ob.type === 'bearish') {
      let score = 0;
      const conf = [];

      if (htfStruct.bias === 'bearish' || htfStruct.bos === 'bearish') {
        score += 15;
        conf.push('HTF Bearish');
      } else if (htfStruct.choch === 'bearish') {
        score += 10;
        conf.push('HTF CHOCH↓');
      } else if (htfStruct.bias === 'neutral') score += 5;

      score += Math.min(20, ob.strength * 0.2);
      conf.push(`OB ${ob.status} (${ob.strength.toFixed(0)})`);

      let liqScore = 0;
      if (liq.buySide && price < liq.buySide * 1.002) {
        liqScore = 12;
        conf.push('Near Buy-side Liq');
      }
      if (liq.equalHighs.length) {
        liqScore = Math.max(liqScore, 8);
        conf.push('Equal Highs');
      }
      score += liqScore;

      if (htfStruct.bos === 'bearish' || htfStruct.choch === 'bearish') {
        score += 15;
        conf.push('Bearish BOS/CHOCH');
      } else if (htfStruct.bias === 'bearish') score += 8;

      const nearFVG = fvgs.find(
        (f) => f.type === 'bearish' && f.low <= ob.high && f.high >= ob.low
      );
      if (nearFVG) {
        score += 10;
        conf.push('FVG overlap');
      } else if (fvgs.some((f) => f.type === 'bearish' && f.status === 'OPEN')) {
        score += 5;
        conf.push('Bearish FVG');
      }

      if (ob.displacement > 0) {
        score += Math.min(10, ob.displacement * 2);
        conf.push('Displacement');
      }
      if (ob.volumeExp || rvol > 1.4) {
        score += 5;
        conf.push('Vol expansion');
      } else if (rvol > 1.1) score += 2;

      if (pd.zone === 'PREMIUM') {
        score += 5;
        conf.push('Premium');
      } else if (pd.zone === 'EQUILIBRIUM') score += 2;

      if (ema20 && price < ema20) {
        score += 3;
        conf.push('Below EMA20');
      }
      if (rsi < 55 && rsi > 30) score += 2;
      score += 3;
      score = Math.min(100, Math.round(score));

      if (includeAll || score >= minScore) {
        const entry =
          style === 'aggressive'
            ? ob.mid
            : style === 'conservative'
              ? ob.high - (ob.high - ob.low) * 0.3
              : ob.high - (ob.high - ob.low) * 0.4;
        const sl = ob.high * 1.0015;
        const risk = sl - entry;
        const tp1 = entry - risk * 1.8;
        const tp2 = entry - risk * 3.0;
        const tp3 = entry - risk * 4.5;
        const rr = risk > 0 ? ((entry - tp1) / risk).toFixed(1) : '—';

        results.push({
          symbol,
          dir: 'SHORT',
          score,
          qualifies: score >= minScore,
          conf,
          ob,
          fvgs: nearFVG ? [nearFVG] : [],
          liq,
          structure: htfStruct,
          pd,
          rvol,
          entry,
          sl,
          tp1,
          tp2,
          tp3,
          rr,
          price,
        });
      }
    }
  }
  return results;
}
