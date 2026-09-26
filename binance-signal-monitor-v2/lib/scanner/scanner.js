/**
 * Server-side market scanner.
 * Preserves original TA + scores; adds lifecycle + dedup.
 */
import {
  loadExchangeInfo,
  loadTickers,
  getKlines,
  clearKlineCache,
} from '../binance/client.js';
import { scoreSetup } from './scoreSetup.js';
import { calcATR } from './indicators.js';
import { SIGNAL_CONFIG, SIGNAL_STATUS } from '../config/signalConfig.js';
import { buildSignalId } from '../signals/signalId.js';
import {
  applyLifecycle,
  buildNewSignalRecord,
} from '../signals/signalLifecycle.js';
import {
  getSignalById,
  getActiveSignals,
  createSignal,
  updateSignal,
  createSignalEvent,
  markNotified,
} from '../database/signals.js';
import {
  createScanRun,
  completeScanRun,
  acquireScanLock,
  releaseScanLock,
} from '../database/scanRuns.js';
import { getState, setState } from '../database/appState.js';
import { dispatchNotifications } from '../telegram/telegram.js';
import { getEntryProximity } from '../signals/proximity.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Vercel Hobby hard-kills a function at 60s and returns a non-JSON error
// page when it does. Stopping ourselves a bit early means the run always
// finishes cleanly — with a valid JSON result and the lock released —
// even if it couldn't get through everything it planned to.
const SOFT_DEADLINE_MS = 40 * 1000; // stop cleanly before Hobby 60s kill

export async function runFullScan(source = 'cron', options = {}) {
  const startedAt = Date.now();
  const timeLeft = () => SOFT_DEADLINE_MS - (Date.now() - startedAt);

  // Allow Scan Now UI to override universe / chunk size per request
  const universe = options.universe != null && options.universe !== ''
    ? options.universe
    : SIGNAL_CONFIG.scanUniverse;
  const chunkSizeCfg = options.chunkSize != null && +options.chunkSize > 0
    ? +options.chunkSize
    : SIGNAL_CONFIG.scanChunkSize;
  // Reset cursor when universe size changes so we start from top volume again
  const resetCursor = !!options.resetCursor;

  const lock = await acquireScanLock();
  if (!lock.acquired) {
    return {
      ok: false,
      skipped: true,
      reason: lock.reason,
    };
  }

  const scanRun = await createScanRun({ source, universe, chunkSize: chunkSizeCfg });
  clearKlineCache();

  let symbolsScanned = 0;
  let signalsCreated = 0;
  const createdSummaries = [];
  let signalsUpdated = 0;
  let errorCount = 0;
  let timedOutSoft = false;
  const errors = [];

  try {
    const symbols = await loadExchangeInfo();
    const tickers = await loadTickers();

    let sorted = Object.entries(tickers)
      .filter(([s]) => symbols.includes(s))
      .sort((a, b) => b[1].volume - a[1].volume)
      .map((e) => e[0]);

    // Top-N by 24h quote volume (e.g. top 200 futures)
    let fullMarket = sorted;
    if (universe !== 'all' && +universe > 0) {
      fullMarket = fullMarket.slice(0, +universe);
    }

    // Rotating chunk so each Vercel request stays under Hobby 60s limit
    let coverage = null;
    let cursorOffset = 0;
    let usingCursor = false;
    if (chunkSizeCfg > 0 && chunkSizeCfg < fullMarket.length) {
      usingCursor = true;
      const chunkSize = Math.min(+chunkSizeCfg, fullMarket.length);
      let cursorState = (await getState('scan_cursor')) || { offset: 0, universe: null };
      if (resetCursor || String(cursorState.universe) !== String(universe)) {
        cursorOffset = 0;
      } else {
        cursorOffset = cursorState.offset % fullMarket.length || 0;
      }

      let chunk = fullMarket.slice(cursorOffset, cursorOffset + chunkSize);
      if (chunk.length < chunkSize) {
        chunk = chunk.concat(fullMarket.slice(0, chunkSize - chunk.length));
      }
      sorted = chunk;

      coverage = {
        chunkSize,
        totalSymbols: fullMarket.length,
        cyclesToFullCoverage: Math.ceil(fullMarket.length / chunkSize),
        cursorOffset,
        universe: +universe || universe,
      };
    } else {
      sorted = fullMarket;
      coverage = {
        chunkSize: fullMarket.length,
        totalSymbols: fullMarket.length,
        cyclesToFullCoverage: 1,
        cursorOffset: 0,
        universe: +universe || universe,
      };
    }
    const htf = SIGNAL_CONFIG.htf;
    const obtf = SIGNAL_CONFIG.obTf;
    const entryStyle = SIGNAL_CONFIG.entryStyle;
    const threshold = SIGNAL_CONFIG.minScore;
    const batchSize = SIGNAL_CONFIG.batchSize;
    const pause = SIGNAL_CONFIG.batchPauseMs;

    // 1) Update existing active signals first (lifecycle) — batched in
    // parallel like the discovery phase below, so a large watchlist can't
    // eat the whole soft-deadline budget sequentially and leave nothing
    // for scanning new coins. Also capped to its own sub-budget so it can
    // never fully starve discovery even with hundreds of active signals.
    const active = SIGNAL_CONFIG.skipLifecycle ? [] : await getActiveSignals();
    // Cap active updates so discovery always gets time (Hobby 60s)
    const activeCap = Math.min(active.length, source === 'manual' ? 12 : 40);
    const activeList = active.slice(0, activeCap);
    const activePhaseDeadline = Math.min(
      Date.now() + 12 * 1000,
      startedAt + SOFT_DEADLINE_MS - 12000
    );
    for (let i = 0; i < activeList.length; i += batchSize) {
      if (timeLeft() < 8000 || Date.now() > activePhaseDeadline) {
        break; // don't mark partial for lifecycle skip
      }
      const batch = activeList.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (sig) => {
          try {
            const price = tickers[sig.symbol]?.price;
            if (!price) return;
            let atr5m = sig.atr_5m;
            try {
              const c5 = await getKlines(sig.symbol, '5m', 50);
              atr5m = calcATR(c5, 14) || atr5m;
            } catch (_) {}

            const { updates, events, notifications } = applyLifecycle(
              sig,
              price,
              atr5m
            );

            if (Object.keys(updates).length) {
              await updateSignal(sig.signal_id, updates);
              signalsUpdated++;
            }
            for (const ev of events) {
              await createSignalEvent({
                signal_id: sig.signal_id,
                event_type: ev.event_type,
                price: ev.price,
                old_status: ev.old_status,
                new_status: ev.new_status,
                message: ev.message,
              });
            }
            if (notifications.length) {
              const sent = await dispatchNotifications(notifications);
              for (const s of sent) {
                if (s.ok) {
                  const flagMap = {
                    READY: 'ready_notified',
                    ENTRY_HIT: 'entry_notified',
                    TP1: 'tp1_notified',
                    TP2: 'tp2_notified',
                    TP3: 'tp3_notified',
                    SL: 'sl_notified',
                    INVALIDATED: 'invalidated_notified',
                  };
                  const flag = flagMap[s.type];
                  if (flag) await markNotified(sig.signal_id, flag);
                }
              }
            }
          } catch (e) {
            errorCount++;
            errors.push(`${sig.symbol}: ${e.message}`);
          }
        })
      );
      if (pause) await sleep(Math.min(pause, 150));
    }

    // 2) Discover new setups
    let processedCount = 0;
    for (let i = 0; i < sorted.length; i += batchSize) {
      if (timeLeft() < 6000) {
        timedOutSoft = true;
        break;
      }
      const batch = sorted.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (sym) => {
          try {
            const price = tickers[sym]?.price;
            if (!price) return;

            const [htfC, obC, c5] = await Promise.all([
              getKlines(sym, htf, SIGNAL_CONFIG.htfKlineLimit || 80),
              getKlines(sym, obtf, SIGNAL_CONFIG.obKlineLimit || 100),
              getKlines(sym, '5m', SIGNAL_CONFIG.atrKlineLimit || 30),
            ]);
            const atr5m = calcATR(c5, 14);

            const results = scoreSetup(
              sym,
              htfC,
              obC,
              entryStyle,
              threshold,
              price
            );

            for (const r of results) {
              const signalId = buildSignalId(
                r.symbol,
                r.dir,
                r.ob?.time,
                r.entry
              );

              // ATR-based proximity (not fixed %)
              const prox = getEntryProximity(
                {
                  entry: r.entry,
                  sl: r.sl,
                  direction: r.dir,
                  ob_high: r.ob?.high,
                  ob_low: r.ob?.low,
                  ob: r.ob,
                },
                price,
                atr5m
              );
              const closeLabel =
                prox.atrDistance <= 0.3
                  ? 'VERY CLOSE'
                  : prox.atrDistance <= 0.5
                    ? 'CLOSE'
                    : prox.atrDistance <= 1.0
                      ? 'NEAR'
                      : 'FAR';

              // Live card for this scan (always, with CURRENT market price)
              const live = {
                signal_id: signalId,
                symbol: r.symbol,
                direction: r.dir,
                status: 'LIVE',
                score: r.score,
                entry: r.entry,
                sl: r.sl,
                tp1: r.tp1,
                tp2: r.tp2,
                tp3: r.tp3,
                rr: r.rr,
                current_price: price,
                price,
                conf: r.conf || [],
                structure: r.structure,
                pd: r.pd,
                rvol: r.rvol,
                fvgs: r.fvgs,
                metadata: {
                  conf: r.conf,
                  structure: r.structure,
                  ob: r.ob,
                  pd: r.pd,
                  rvol: r.rvol,
                  fvgs: r.fvgs,
                  htf: SIGNAL_CONFIG.htf,
                  obTf: SIGNAL_CONFIG.obTf,
                  entryStyle: SIGNAL_CONFIG.entryStyle,
                },
                ob_low: r.ob?.low,
                ob_high: r.ob?.high,
                atr_5m: prox.atr5m,
                distance_to_entry: prox.distanceToEntry,
                distance_percent: prox.distancePercent,
                atr_distance: prox.atrDistance,
                proximity_score: prox.proximityScore,
                ready_threshold: prox.readyThreshold,
                ready_threshold_atr: prox.readyThresholdATR,
                is_close: prox.isReady,
                close_label: closeLabel,
                last_updated_at: new Date().toISOString(),
              };
              createdSummaries.push(live);
              signalsCreated++;

              // Optional DB persist (off in live mode)
              if (SIGNAL_CONFIG.persistSignals) {
                const existing = await getSignalById(signalId);
                if (!existing) {
                  const record = buildNewSignalRecord(r, signalId, atr5m);
                  await createSignal(record);
                  await createSignalEvent({
                    signal_id: signalId,
                    event_type: 'SIGNAL_CREATED',
                    price,
                    old_status: null,
                    new_status: record.status,
                    message: `Created score ${r.score}`,
                  });
                }
              }
            }
            symbolsScanned++;
          } catch (e) {
            errorCount++;
            errors.push(`${sym}: ${e.message}`);
          } finally {
            processedCount++;
          }
        })
      );
      if (pause) await sleep(Math.min(pause, 100));
    }

    // Advance the rotating cursor only by what was actually processed, so
    // a soft-timeout resumes from the right place next time instead of
    // skipping the symbols it didn't get to.
    if (usingCursor) {
      const nextOffset = (cursorOffset + processedCount) % fullMarket.length;
      await setState('scan_cursor', {
        offset: nextOffset,
        universe: universe === 'all' ? 'all' : +universe,
      });
      if (coverage) {
        coverage.symbolsThisRun = processedCount;
        coverage.nextOffset = nextOffset;
      }
    }

    // Live mode: Telegram for signals close to entry
    let telegramSent = 0;
    if (
      SIGNAL_CONFIG.telegramOnLiveClose &&
      createdSummaries.length &&
      (SIGNAL_CONFIG.skipLifecycle || !SIGNAL_CONFIG.persistSignals)
    ) {
      const maxAtr = SIGNAL_CONFIG.telegramLiveMaxAtr ?? 0.5;
      const maxN = SIGNAL_CONFIG.telegramLiveMaxPerScan ?? 8;
      const closeOnes = createdSummaries
        .filter(
          (s) =>
            s.atr_distance != null &&
            s.atr_distance <= maxAtr
        )
        .sort((a, b) => (a.atr_distance ?? 99) - (b.atr_distance ?? 99))
        .slice(0, maxN);

      for (const s of closeOnes) {
        try {
          const sent = await dispatchNotifications([
            { type: 'READY', signal: s },
          ]);
          if (sent[0]?.ok) telegramSent++;
        } catch (e) {
          errors.push(`telegram ${s.symbol}: ${e.message}`);
          errorCount++;
        }
      }
    }

    // Counts — live mode: from this scan only
    let watching_count = 0;
    let ready_count = 0;
    let ongoing_count = 0;
    if (SIGNAL_CONFIG.persistSignals && !SIGNAL_CONFIG.skipLifecycle) {
      const afterActive = await getActiveSignals();
      watching_count = afterActive.filter((s) => s.status === SIGNAL_STATUS.WATCHING).length;
      ready_count = afterActive.filter((s) => s.status === SIGNAL_STATUS.READY).length;
      ongoing_count = afterActive.filter((s) => s.status === SIGNAL_STATUS.ONGOING).length;
    } else {
      ready_count = createdSummaries.length;
    }

    await completeScanRun(scanRun.id, {
      symbols_scanned: symbolsScanned,
      signals_created: signalsCreated,
      signals_updated: signalsUpdated,
      ready_count,
      ongoing_count,
      watching_count,
      error_count: errorCount,
      error_message: errors.length ? errors.slice(0, 20).join('; ') : null,
      metadata: {
        totalSymbols: sorted.length,
        coverage,
        timedOutSoft,
        errors: errors.slice(0, 50),
      },
    });

    await releaseScanLock();

    return {
      ok: true,
      partial: timedOutSoft,
      scanRunId: scanRun.id,
      symbolsScanned,
      signalsCreated,
      signalsUpdated,
      watching_count,
      ready_count,
      ongoing_count,
      errorCount,
      coverage,
      created: createdSummaries,
      liveSignals: createdSummaries,
      telegramSent,
    };
  } catch (e) {
    await completeScanRun(scanRun.id, {
      status: 'FAILED',
      error_message: e.message,
      symbols_scanned: symbolsScanned,
      signals_created: signalsCreated,
      signals_updated: signalsUpdated,
      error_count: errorCount + 1,
    });
    await releaseScanLock();
    throw e;
  }
}
