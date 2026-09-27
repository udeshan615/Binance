/**
 * Database abstraction layer.
 * Production: Supabase via service role (server-only).
 * Development (no env): in-memory store (NOT for production).
 */
import { createClient } from '@supabase/supabase-js';

let supabase = null;
let memoryStore = null;

function isSupabaseConfigured() {
  return !!(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export function getDb() {
  if (isSupabaseConfigured()) {
    if (!supabase) {
      supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
    }
    return { type: 'supabase', client: supabase };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production. ' +
        'Configure environment variables before deploying.'
    );
  }

  // Dev-only in-memory fallback
  if (!memoryStore) {
    memoryStore = {
      signals: new Map(),
      events: [],
      scanRuns: [],
      appState: new Map(),
      lock: null,
    };
    console.warn(
      '[DB] Using in-memory store (development only). Connect Supabase for production.'
    );
  }
  return { type: 'memory', store: memoryStore };
}

export function isProductionDbReady() {
  return isSupabaseConfigured();
}
