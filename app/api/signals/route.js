import { NextResponse } from 'next/server';
import {
  getActiveSignals,
  getHistorySignals,
  getRecentSignals,
} from '../../../lib/database/signals.js';
import { getLastScanRun } from '../../../lib/database/scanRuns.js';
import { SIGNAL_STATUS } from '../../../lib/config/signalConfig.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [active, history, lastScan, recent] = await Promise.all([
      getActiveSignals(),
      getHistorySignals(100),
      getLastScanRun(),
      getRecentSignals(40),
    ]);

    const norm = (s) => String(s?.status || '').trim().toUpperCase();
    let pool = active || [];
    // Safety net: if active query returned empty but recent has rows, use recent
    if (!pool.length && recent?.length) {
      pool = recent.filter((s) =>
        ['WATCHING', 'READY', 'ONGOING'].includes(norm(s))
      );
    }
    const ongoing = pool
      .filter((s) => norm(s) === SIGNAL_STATUS.ONGOING)
      .sort(
        (a, b) =>
          new Date(b.last_updated_at || b.created_at || 0) -
          new Date(a.last_updated_at || a.created_at || 0)
      );
    const ready = pool
      .filter((s) => norm(s) === SIGNAL_STATUS.READY)
      .sort(
        (a, b) =>
          (a.distance_percent ?? 999) - (b.distance_percent ?? 999)
      );
    const watching = pool
      .filter((s) => norm(s) === SIGNAL_STATUS.WATCHING)
      .sort((a, b) => {
        const dp = (a.distance_percent ?? 999) - (b.distance_percent ?? 999);
        if (Math.abs(dp) > 0.01) return dp;
        return (b.score || 0) - (a.score || 0);
      });

    return NextResponse.json({
      ongoing,
      ready,
      watching,
      history,
      recent,
      lastScan,
      counts: {
        ongoing: ongoing.length,
        ready: ready.length,
        watching: watching.length,
        history: history.length,
        recent: (recent || []).length,
        activeTotal: active.length,
      },
    });
  } catch (e) {
    console.error('[api/signals]', e);
    return NextResponse.json(
      { error: e.message, ongoing: [], ready: [], watching: [], history: [] },
      { status: 500 }
    );
  }
}
