/**
 * Full lifecycle mode (recommended):
 * - Signals are saved to Supabase
 * - WATCHING → READY → ONGOING → TP1/TP2/TP3 / SL updates
 * - Telegram notifications on every meaningful state change
 *
 * Works on Vercel Free when you use an external free cron
 * (cron-job.org) — see README.
 */
export const SIGNAL_CONFIG = {
  minScore: 70,

  htf: '4h',
  obTf: '1h',
  setupTf: '15m',
  entryTf: '5m',
  entryStyle: 'conservative',

  readyDistanceATR: 0.5,
  entryToleranceATR: 0.15,
  minReadyDistancePct: 0.05,
  maxReadyDistancePct: 1.5,

  maxSignalAgeHours: 48,

  scanIntervalMinutes: 5,
  batchSize: 5,
  batchPauseMs: 80,

  // Smaller universe + chunk so Hobby 60s limit is safe
  scanUniverse: 80,
  scanChunkSize: 12,

  htfKlineLimit: 80,
  obKlineLimit: 100,
  atrKlineLimit: 30,

  // FULL LIFECYCLE — save signals + send TP/SL updates to Telegram
  persistSignals: true,
  skipLifecycle: false,

  // Live one-shot mode (only used if skipLifecycle=true)
  telegramOnLiveClose: false,
  telegramLiveMaxPerScan: 8,
  telegramLiveMaxAtr: 0.5,

  maxWatchingSignals: 200,
  maxReadySignals: 100,
  maxOngoingSignals: 100,
  maxHistorySignals: 200,

  binanceBaseUrl: process.env.BINANCE_API_BASE_URL || 'https://fapi.binance.com',
  klineCacheMs: 60000,
};

export const SIGNAL_STATUS = {
  WATCHING: 'WATCHING',
  READY: 'READY',
  ONGOING: 'ONGOING',
  COMPLETED_PROFIT: 'COMPLETED_PROFIT',
  STOPPED: 'STOPPED',
  INVALIDATED: 'INVALIDATED',
};

export const ALLOWED_TRANSITIONS = {
  WATCHING: ['READY', 'INVALIDATED'],
  READY: ['ONGOING', 'INVALIDATED'],
  ONGOING: ['COMPLETED_PROFIT', 'STOPPED'],
  COMPLETED_PROFIT: [],
  STOPPED: [],
  INVALIDATED: [],
};

export function canTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}
