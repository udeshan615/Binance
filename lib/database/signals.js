import { getDb } from './index.js';
import { SIGNAL_STATUS } from '../config/signalConfig.js';

const ACTIVE = [
  SIGNAL_STATUS.WATCHING,
  SIGNAL_STATUS.READY,
  SIGNAL_STATUS.ONGOING,
];

export async function getSignalById(signalId) {
  const db = getDb();
  if (db.type === 'supabase') {
    const { data, error } = await db.client
      .from('signals')
      .select('*')
      .eq('signal_id', signalId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
  return db.store.signals.get(signalId) || null;
}

export async function getActiveSignals() {
  const db = getDb();
  if (db.type === 'supabase') {
    // Query each status separately (more reliable than .in() on large tables)
    // Cap WATCHING so the dashboard stays usable
    const limits = {
      [SIGNAL_STATUS.ONGOING]: 50,
      [SIGNAL_STATUS.READY]: 50,
      [SIGNAL_STATUS.WATCHING]: 80,
    };
    const parts = await Promise.all(
      ACTIVE.map(async (status) => {
        const { data, error } = await db.client
          .from('signals')
          .select('*')
          .eq('status', status)
          .order('created_at', { ascending: false })
          .limit(limits[status] || 50);
        if (error) {
          console.error('[getActiveSignals]', status, error.message);
          // fallback without order
          const fb = await db.client
            .from('signals')
            .select('*')
            .eq('status', status)
            .limit(limits[status] || 50);
          if (fb.error) throw fb.error;
          return fb.data || [];
        }
        return data || [];
      })
    );
    return parts.flat();
  }
  return [...db.store.signals.values()].filter((s) =>
    ACTIVE.includes(String(s.status || '').trim().toUpperCase())
  );
}

export async function getSignalsByStatus(status) {
  const db = getDb();
  if (db.type === 'supabase') {
    const { data, error } = await db.client
      .from('signals')
      .select('*')
      .eq('status', status)
      .order('last_updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }
  return [...db.store.signals.values()].filter((s) => s.status === status);
}


export async function getRecentSignals(limit = 30) {
  const db = getDb();
  if (db.type === 'supabase') {
    const { data, error } = await db.client
      .from('signals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }
  return [...db.store.signals.values()]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, limit);
}

export async function getHistorySignals(limit = 100) {
  const db = getDb();
  const done = [
    SIGNAL_STATUS.COMPLETED_PROFIT,
    SIGNAL_STATUS.STOPPED,
    SIGNAL_STATUS.INVALIDATED,
  ];
  if (db.type === 'supabase') {
    const { data, error } = await db.client
      .from('signals')
      .select('*')
      .in('status', done)
      .order('completed_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }
  return [...db.store.signals.values()]
    .filter((s) => done.includes(s.status))
    .sort(
      (a, b) =>
        new Date(b.completed_at || b.last_updated_at) -
        new Date(a.completed_at || a.last_updated_at)
    )
    .slice(0, limit);
}

function sanitizeSignalRecord(record) {
  const r = { ...record };
  // numeric columns — never send em-dash or NaN
  for (const k of [
    'score', 'entry', 'entry_hit_price', 'sl', 'tp1', 'tp2', 'tp3', 'rr',
    'current_price', 'current_pnl_percent', 'atr_5m', 'distance_to_entry',
    'distance_percent', 'atr_distance', 'proximity_score', 'ready_threshold',
    'ob_low', 'ob_high', 'last_price', 'max_profit_percent', 'max_loss_percent',
  ]) {
    if (r[k] === '—' || r[k] === '' || r[k] === undefined) r[k] = null;
    else if (r[k] != null && !Number.isNaN(+r[k])) r[k] = +r[k];
  }
  if (!r.status) r.status = 'WATCHING';
  if (!r.direction) r.direction = 'LONG';
  // metadata must be plain JSON
  if (r.metadata && typeof r.metadata === 'object') {
    try {
      r.metadata = JSON.parse(JSON.stringify(r.metadata));
    } catch {
      r.metadata = {};
    }
  }
  return r;
}

export async function createSignal(record) {
  const db = getDb();
  const clean = sanitizeSignalRecord(record);
  if (db.type === 'supabase') {
    const { data, error } = await db.client
      .from('signals')
      .insert(clean)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const id = clean.signal_id;
  db.store.signals.set(id, { ...clean, id });
  return db.store.signals.get(id);
}

export async function updateSignal(signalId, updates) {
  const db = getDb();
  if (db.type === 'supabase') {
    const { data, error } = await db.client
      .from('signals')
      .update({ ...updates, last_updated_at: new Date().toISOString() })
      .eq('signal_id', signalId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const existing = db.store.signals.get(signalId);
  if (!existing) return null;
  const merged = {
    ...existing,
    ...updates,
    last_updated_at: new Date().toISOString(),
  };
  db.store.signals.set(signalId, merged);
  return merged;
}

export async function createSignalEvent(event) {
  const db = getDb();
  const row = {
    ...event,
    created_at: event.created_at || new Date().toISOString(),
  };
  if (db.type === 'supabase') {
    const { data, error } = await db.client
      .from('signal_events')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  row.id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.store.events.push(row);
  return row;
}

export async function getSignalEvents(signalId) {
  const db = getDb();
  if (db.type === 'supabase') {
    const { data, error } = await db.client
      .from('signal_events')
      .select('*')
      .eq('signal_id', signalId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  }
  return db.store.events.filter((e) => e.signal_id === signalId);
}

export async function markNotified(signalId, flag) {
  return updateSignal(signalId, { [flag]: true });
}
