import { NextResponse } from 'next/server';
import { getLastScanRun } from '../../../lib/database/scanRuns.js';
import { getActiveSignals } from '../../../lib/database/signals.js';
import { SIGNAL_STATUS, SIGNAL_CONFIG } from '../../../lib/config/signalConfig.js';
import { isProductionDbReady } from '../../../lib/database/index.js';
import { runFullScan } from '../../../lib/scanner/scanner.js';
import { getState } from '../../../lib/database/appState.js';

export const dynamic = 'force-dynamic';
// Hobby plan max is 60s — do not raise above this on free tier
export const maxDuration = 60;

export async function GET() {
  try {
    const [lastScan, active] = await Promise.all([
      getLastScanRun(),
      getActiveSignals(),
    ]);

    const counts = {
      watching: active.filter((s) => s.status === SIGNAL_STATUS.WATCHING)
        .length,
      ready: active.filter((s) => s.status === SIGNAL_STATUS.READY).length,
      ongoing: active.filter((s) => s.status === SIGNAL_STATUS.ONGOING)
        .length,
    };

    let nextScan = null;
    if (lastScan?.completed_at || lastScan?.started_at) {
      const base = new Date(lastScan.completed_at || lastScan.started_at);
      nextScan = new Date(
        base.getTime() + SIGNAL_CONFIG.scanIntervalMinutes * 60 * 1000
      ).toISOString();
    }

    let autoScan = false;
    try {
      autoScan = !!(await getState('auto_scan_enabled', false));
    } catch (_) {}

    return NextResponse.json({
      dbReady: isProductionDbReady() || process.env.NODE_ENV !== 'production',
      lastScan,
      nextScan,
      counts,
      auto_scan_enabled: autoScan,
      config: {
        minScore: SIGNAL_CONFIG.minScore,
        htf: SIGNAL_CONFIG.htf,
        obTf: SIGNAL_CONFIG.obTf,
        entryStyle: SIGNAL_CONFIG.entryStyle,
        scanIntervalMinutes: SIGNAL_CONFIG.scanIntervalMinutes,
        scanUniverse: SIGNAL_CONFIG.scanUniverse,
        scanChunkSize: SIGNAL_CONFIG.scanChunkSize,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * Manual Scan Now
 * Body (optional JSON):
 *   { universe: 200, chunkSize: 30, resetCursor: true }
 * universe = top N by volume (or "all")
 * chunkSize = symbols per request (keep ≤35 on Hobby)
 */
export async function POST(request) {
  if (process.env.NODE_ENV === 'production' && !isProductionDbReady()) {
    return NextResponse.json(
      {
        error:
          'Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      },
      { status: 503 }
    );
  }

  let options = {};
  try {
    const body = await request.json();
    if (body && typeof body === 'object') {
      options = {
        universe: body.universe,
        chunkSize: body.chunkSize,
        resetCursor: !!body.resetCursor,
      };
    }
  } catch (_) {
    // empty body is fine
  }

  try {
    const result = await runFullScan('manual', options);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[scan/manual]', e);
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}
