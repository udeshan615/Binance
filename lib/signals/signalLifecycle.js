import {
  SIGNAL_STATUS,
  canTransition,
  SIGNAL_CONFIG,
} from '../config/signalConfig.js';
import { getEntryProximity, calcPnlPercent, checkTpSl } from './proximity.js';

/**
 * Apply lifecycle rules to an existing signal given current market data.
 * Returns { nextStatus, updates, events, notifications }
 * Does NOT persist — caller persists.
 */
export function applyLifecycle(signal, currentPrice, atr5m, now = new Date()) {
  const status = signal.status;
  const updates = {
    current_price: currentPrice,
    last_checked_at: now.toISOString(),
    last_price: currentPrice,
  };
  const events = [];
  const notifications = [];

  // Age invalidation for pre-entry
  if (
    (status === SIGNAL_STATUS.WATCHING || status === SIGNAL_STATUS.READY) &&
    signal.created_at
  ) {
    const ageHrs =
      (now.getTime() - new Date(signal.created_at).getTime()) / 3600000;
    if (ageHrs > SIGNAL_CONFIG.maxSignalAgeHours) {
      if (canTransition(status, SIGNAL_STATUS.INVALIDATED)) {
        updates.status = SIGNAL_STATUS.INVALIDATED;
        updates.invalidated_at = now.toISOString();
        updates.last_updated_at = now.toISOString();
        events.push({
          event_type: 'INVALIDATED',
          old_status: status,
          new_status: SIGNAL_STATUS.INVALIDATED,
          price: currentPrice,
          message: `Max age ${SIGNAL_CONFIG.maxSignalAgeHours}h exceeded`,
        });
        if (!signal.invalidated_notified) {
          notifications.push({ type: 'INVALIDATED', signal: { ...signal, ...updates } });
        }
        return { nextStatus: SIGNAL_STATUS.INVALIDATED, updates, events, notifications };
      }
    }
  }

  const prox = getEntryProximity(signal, currentPrice, atr5m);
  updates.distance_to_entry = prox.distanceToEntry;
  updates.distance_percent = prox.distancePercent;
  updates.atr_distance = prox.atrDistance;
  updates.proximity_score = prox.proximityScore;
  updates.ready_threshold = prox.readyThreshold;
  updates.atr_5m = prox.atr5m;

  // --- WATCHING ---
  if (status === SIGNAL_STATUS.WATCHING) {
    if (prox.entryHit) {
      // Jump straight to ONGOING if price already at entry
      if (canTransition(SIGNAL_STATUS.WATCHING, SIGNAL_STATUS.READY)) {
        // first mark ready then ongoing in one step via READY path
      }
      // Prefer READY → ONGOING; but allow direct if needed
      updates.status = SIGNAL_STATUS.ONGOING;
      updates.entry_hit_at = now.toISOString();
      updates.entry_hit_price = currentPrice;
      updates.ready_at = updates.ready_at || now.toISOString();
      updates.last_updated_at = now.toISOString();
      events.push({
        event_type: 'ENTRY_HIT',
        old_status: status,
        new_status: SIGNAL_STATUS.ONGOING,
        price: currentPrice,
        message: 'Entry zone reached',
      });
      if (!signal.entry_notified) {
        notifications.push({ type: 'ENTRY_HIT', signal: { ...signal, ...updates } });
      }
      return { nextStatus: SIGNAL_STATUS.ONGOING, updates, events, notifications };
    }
    if (prox.isReady && canTransition(status, SIGNAL_STATUS.READY)) {
      updates.status = SIGNAL_STATUS.READY;
      updates.ready_at = now.toISOString();
      updates.last_updated_at = now.toISOString();
      events.push({
        event_type: 'READY',
        old_status: status,
        new_status: SIGNAL_STATUS.READY,
        price: currentPrice,
        message: `Proximity ${prox.proximityScore}% (≤ ${prox.readyThresholdATR.toFixed(2)} ATR)`,
      });
      if (!signal.ready_notified) {
        notifications.push({ type: 'READY', signal: { ...signal, ...updates } });
      }
      return { nextStatus: SIGNAL_STATUS.READY, updates, events, notifications };
    }
  }

  // --- READY ---
  if (status === SIGNAL_STATUS.READY) {
    if (prox.entryHit && canTransition(status, SIGNAL_STATUS.ONGOING)) {
      updates.status = SIGNAL_STATUS.ONGOING;
      updates.entry_hit_at = now.toISOString();
      updates.entry_hit_price = currentPrice;
      updates.last_updated_at = now.toISOString();
      events.push({
        event_type: 'ENTRY_HIT',
        old_status: status,
        new_status: SIGNAL_STATUS.ONGOING,
        price: currentPrice,
        message: 'Entry zone reached',
      });
      if (!signal.entry_notified) {
        notifications.push({ type: 'ENTRY_HIT', signal: { ...signal, ...updates } });
      }
      return { nextStatus: SIGNAL_STATUS.ONGOING, updates, events, notifications };
    }
    // still ready or drifted away — stay READY (no reverse to WATCHING)
  }

  // --- ONGOING ---
  if (status === SIGNAL_STATUS.ONGOING) {
    const pnl = calcPnlPercent(signal, currentPrice);
    updates.current_pnl_percent = pnl;
    if (signal.max_profit_percent == null || pnl > +signal.max_profit_percent) {
      updates.max_profit_percent = pnl;
    }
    if (signal.max_loss_percent == null || pnl < +signal.max_loss_percent) {
      updates.max_loss_percent = pnl;
    }

    const hits = checkTpSl(signal, currentPrice);

    if (hits.slHit && canTransition(status, SIGNAL_STATUS.STOPPED)) {
      updates.status = SIGNAL_STATUS.STOPPED;
      updates.stopped_at = now.toISOString();
      updates.completed_at = now.toISOString();
      updates.last_updated_at = now.toISOString();
      events.push({
        event_type: 'STOPPED',
        old_status: status,
        new_status: SIGNAL_STATUS.STOPPED,
        price: currentPrice,
        message: `SL hit @ ${currentPrice}`,
      });
      if (!signal.sl_notified) {
        notifications.push({ type: 'SL', signal: { ...signal, ...updates } });
      }
      return { nextStatus: SIGNAL_STATUS.STOPPED, updates, events, notifications };
    }

    if (hits.tp1Hit && !signal.tp1_hit) {
      updates.tp1_hit = true;
      updates.tp1_hit_at = now.toISOString();
      updates.last_updated_at = now.toISOString();
      events.push({
        event_type: 'TP1_HIT',
        old_status: status,
        new_status: status,
        price: currentPrice,
        message: 'TP1 reached',
      });
      if (!signal.tp1_notified) {
        notifications.push({ type: 'TP1', signal: { ...signal, ...updates } });
      }
    }
    if (hits.tp2Hit && !signal.tp2_hit) {
      updates.tp2_hit = true;
      updates.tp2_hit_at = now.toISOString();
      updates.last_updated_at = now.toISOString();
      events.push({
        event_type: 'TP2_HIT',
        old_status: status,
        new_status: status,
        price: currentPrice,
        message: 'TP2 reached',
      });
      if (!signal.tp2_notified) {
        notifications.push({ type: 'TP2', signal: { ...signal, ...updates } });
      }
    }
    if (hits.tp3Hit && canTransition(status, SIGNAL_STATUS.COMPLETED_PROFIT)) {
      updates.tp3_hit = true;
      updates.tp3_hit_at = now.toISOString();
      updates.status = SIGNAL_STATUS.COMPLETED_PROFIT;
      updates.completed_at = now.toISOString();
      updates.last_updated_at = now.toISOString();
      events.push({
        event_type: 'TP3_HIT',
        old_status: status,
        new_status: SIGNAL_STATUS.COMPLETED_PROFIT,
        price: currentPrice,
        message: 'TP3 reached — completed',
      });
      if (!signal.tp3_notified) {
        notifications.push({ type: 'TP3', signal: { ...signal, ...updates } });
      }
      return {
        nextStatus: SIGNAL_STATUS.COMPLETED_PROFIT,
        updates,
        events,
        notifications,
      };
    }

    // apply tp flags even if not completing
    if (hits.tp1Hit) updates.tp1_hit = true;
    if (hits.tp2Hit) updates.tp2_hit = true;
  }

  updates.last_updated_at = now.toISOString();
  return { nextStatus: status, updates, events, notifications };
}

/**
 * Build a new WATCHING signal record from scan result.
 */
export function buildNewSignalRecord(scanResult, signalId, atr5m, now = new Date()) {
  const price = scanResult.price;
  const dir = scanResult.dir;
  const prox = getEntryProximity(
    {
      entry: scanResult.entry,
      sl: scanResult.sl,
      direction: dir,
      ob_high: scanResult.ob?.high,
      ob_low: scanResult.ob?.low,
      ob: scanResult.ob,
    },
    price,
    atr5m
  );

  let status = SIGNAL_STATUS.WATCHING;
  if (prox.entryHit) status = SIGNAL_STATUS.ONGOING;
  else if (prox.isReady) status = SIGNAL_STATUS.READY;

  return {
    signal_id: signalId,
    symbol: scanResult.symbol,
    direction: dir,
    status,
    score: scanResult.score,
    entry: scanResult.entry,
    entry_hit_price: status === SIGNAL_STATUS.ONGOING ? price : null,
    sl: scanResult.sl,
    tp1: scanResult.tp1,
    tp2: scanResult.tp2,
    tp3: scanResult.tp3,
    rr: scanResult.rr,
    current_price: price,
    current_pnl_percent: 0,
    atr_5m: atr5m,
    distance_to_entry: prox.distanceToEntry,
    distance_percent: prox.distancePercent,
    atr_distance: prox.atrDistance,
    proximity_score: prox.proximityScore,
    ready_threshold: prox.readyThreshold,
    ob_low: scanResult.ob?.low,
    ob_high: scanResult.ob?.high,
    ob_time: scanResult.ob?.time
      ? new Date(scanResult.ob.time * 1000).toISOString()
      : null,
    created_at: now.toISOString(),
    ready_at: status === SIGNAL_STATUS.READY || status === SIGNAL_STATUS.ONGOING ? now.toISOString() : null,
    entry_hit_at: status === SIGNAL_STATUS.ONGOING ? now.toISOString() : null,
    last_checked_at: now.toISOString(),
    last_updated_at: now.toISOString(),
    last_price: price,
    max_profit_percent: 0,
    max_loss_percent: 0,
    tp1_hit: false,
    tp2_hit: false,
    tp3_hit: false,
    ready_notified: false,
    entry_notified: false,
    tp1_notified: false,
    tp2_notified: false,
    tp3_notified: false,
    sl_notified: false,
    invalidated_notified: false,
    metadata: {
      conf: scanResult.conf,
      structure: scanResult.structure,
      pd: scanResult.pd,
      rvol: scanResult.rvol,
      ob: scanResult.ob,
      fvgs: scanResult.fvgs,
    },
  };
}
