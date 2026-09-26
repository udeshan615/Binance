import { NextResponse } from 'next/server';
import { runFullScan } from '../../../../lib/scanner/scanner.js';
import { isProductionDbReady } from '../../../../lib/database/index.js';
import { getState } from '../../../../lib/database/appState.js';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return handleScan(request);
}

export async function POST(request) {
  return handleScan(request);
}

async function handleScan(request) {
  const authHeader = request.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const querySecret = url.searchParams.get('secret');

  if (cronSecret) {
    const token = authHeader.replace(/^Bearer\s+/i, '') || querySecret;
    if (token !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 }
    );
  }

  // Auto-scan toggle — default OFF
  try {
    const enabled = await getState('auto_scan_enabled', false);
    if (!enabled) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'auto_scan_enabled is false — start from dashboard',
      });
    }
  } catch (e) {
    console.error('[cron] auto_scan check failed', e.message);
  }

  if (process.env.NODE_ENV === 'production' && !isProductionDbReady()) {
    return NextResponse.json(
      {
        error:
          'Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      },
      { status: 503 }
    );
  }

  try {
    const result = await runFullScan('cron');
    return NextResponse.json(result);
  } catch (e) {
    console.error('[cron/scan]', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
