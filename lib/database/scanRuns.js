import { getDb } from './index.js';

const LOCK_KEY = 'scan_lock';
// Vercel Hobby hard-caps functions at 60s regardless of maxDuration set in
// code, so any scan still "RUNNING" past that was killed mid-flight and
// never released its lock. Keep this just above the real cap so a dead
// scan self-clears fast instead of blocking the button for minutes.
const LOCK_TTL_MS = 90 * 1000; // 90s

export async function createScanRun(meta = {}) {
  const db = getDb();
  const row = {
    started_at: new Date().toISOString(),
    status: 'RUNNING',
    symbols_scanned: 0,
    signals_created: 0,
    signals_updated: 0,
    ready_count: 0,
    ongoing_count: 0,
    watching_count: 0,
    error_count: 0,
    metadata: meta,
  };
  if (db.type === 'supabase') {
    const { data, error } = await db.client
      .from('scan_runs')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  row.id = `scan_${Date.now()}`;
  db.store.scanRuns.push(row);
  return row;
}

export async function completeScanRun(id, updates) {
  const db = getDb();
  const patch = {
    ...updates,
    completed_at: new Date().toISOString(),
    status: updates.status || 'COMPLETED',
  };
  if (db.type === 'supabase') {
    const { data, error } = await db.client
      .from('scan_runs')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const idx = db.store.scanRuns.findIndex((r) => r.id === id);
  if (idx >= 0) {
    db.store.scanRuns[idx] = { ...db.store.scanRuns[idx], ...patch };
    return db.store.scanRuns[idx];
  }
  return null;
}

export async function getLastScanRun() {
  const db = getDb();
  if (db.type === 'supabase') {
    const { data, error } = await db.client
      .from('scan_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
  const runs = db.store.scanRuns;
  return runs.length ? runs[runs.length - 1] : null;
}

/**
 * DB-based scan lock for serverless (prevent concurrent full scans).
 */
export async function acquireScanLock() {
  const db = getDb();
  const now = Date.now();

  if (db.type === 'memory') {
    if (db.store.lock && now - db.store.lock < LOCK_TTL_MS) {
      return { acquired: false, reason: 'Scan already running (memory lock)' };
    }
    db.store.lock = now;
    return { acquired: true };
  }

  // Supabase: use scan_runs with status RUNNING as soft lock
  const { data: running } = await db.client
    .from('scan_runs')
    .select('id, started_at')
    .eq('status', 'RUNNING')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (running) {
    const age = now - new Date(running.started_at).getTime();
    if (age < LOCK_TTL_MS) {
      return { acquired: false, reason: 'Previous scan still RUNNING' };
    }
    // Stale lock — mark failed
    await db.client
      .from('scan_runs')
      .update({ status: 'FAILED', error_message: 'Stale lock timeout', completed_at: new Date().toISOString() })
      .eq('id', running.id);
  }
  return { acquired: true };
}

export async function releaseScanLock() {
  const db = getDb();
  if (db.type === 'memory') {
    db.store.lock = null;
  }
  // Supabase lock is released by completing the scan_run
}
