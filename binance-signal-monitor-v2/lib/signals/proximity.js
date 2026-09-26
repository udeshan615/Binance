import { SIGNAL_CONFIG } from '../config/signalConfig.js';

/**
 * Dynamic entry proximity using ATR + OB width.
 */
export function getEntryProximity(signal, currentPrice, atr5m) {
  const entry = +signal.entry;
  const price = +currentPrice;
  const distanceToEntry = Math.abs(price - entry);
  const distancePercent = entry ? (distanceToEntry / entry) * 100 : 999;

  const obHigh = +(signal.ob_high ?? signal.ob?.high ?? entry);
  const obLow = +(signal.ob_low ?? signal.ob?.low ?? entry);
  const obWidth = Math.abs(obHigh - obLow) || distanceToEntry;
  const riskDistance = Math.abs(entry - +(signal.sl ?? entry));

  const atr = atr5m && atr5m > 0 ? atr5m : riskDistance * 0.3 || entry * 0.002;

  // readyDistance = min(0.5 * ATR, 0.5 * OB_width) with safety bounds
  let readyDistance = Math.min(
    SIGNAL_CONFIG.readyDistanceATR * atr,
    0.5 * obWidth
  );

  // Convert to % bounds
  const minDist = (SIGNAL_CONFIG.minReadyDistancePct / 100) * entry;
  const maxDist = (SIGNAL_CONFIG.maxReadyDistancePct / 100) * entry;
  readyDistance = Math.max(minDist, Math.min(maxDist, readyDistance));

  const atrDistance = atr > 0 ? distanceToEntry / atr : 999;
  const proximityScore = Math.max(
    0,
    Math.min(100, Math.round((1 - distanceToEntry / (readyDistance * 2 || 1)) * 100))
  );

  const isReady = distanceToEntry <= readyDistance;

  // Entry hit tolerance
  const entryTol = SIGNAL_CONFIG.entryToleranceATR * atr;
  let entryHit = false;
  if (signal.direction === 'LONG' || signal.dir === 'LONG') {
    entryHit = price <= entry + entryTol && price >= Math.min(entry, +signal.sl) - entryTol * 0.5;
  } else {
    entryHit = price >= entry - entryTol && price <= Math.max(entry, +signal.sl) + entryTol * 0.5;
  }

  return {
    distanceToEntry,
    distancePercent,
    atrDistance,
    obWidth,
    riskDistance,
    readyThreshold: readyDistance,
    readyThresholdATR: atr > 0 ? readyDistance / atr : SIGNAL_CONFIG.readyDistanceATR,
    proximityScore,
    isReady,
    entryHit,
    atr5m: atr,
  };
}

export function calcPnlPercent(signal, currentPrice) {
  const entry = +(signal.entry_hit_price || signal.entry);
  const price = +currentPrice;
  if (!entry) return 0;
  if (signal.direction === 'LONG' || signal.dir === 'LONG') {
    return ((price - entry) / entry) * 100;
  }
  return ((entry - price) / entry) * 100;
}

export function checkTpSl(signal, currentPrice) {
  const price = +currentPrice;
  const dir = signal.direction || signal.dir;
  const result = {
    tp1Hit: !!signal.tp1_hit,
    tp2Hit: !!signal.tp2_hit,
    tp3Hit: !!signal.tp3_hit,
    slHit: false,
  };

  if (dir === 'LONG') {
    if (price >= +signal.tp1) result.tp1Hit = true;
    if (price >= +signal.tp2) result.tp2Hit = true;
    if (price >= +signal.tp3) result.tp3Hit = true;
    if (price <= +signal.sl) result.slHit = true;
  } else {
    if (price <= +signal.tp1) result.tp1Hit = true;
    if (price <= +signal.tp2) result.tp2Hit = true;
    if (price <= +signal.tp3) result.tp3Hit = true;
    if (price >= +signal.sl) result.slHit = true;
  }
  return result;
}
