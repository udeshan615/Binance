'use client';

import { useEffect, useState, useCallback } from 'react';
import './globals.css';

function fmt(n, d = 4) {
  if (n == null || Number.isNaN(+n)) return '—';
  return Number(n).toFixed(d);
}

function fmtPct(n) {
  if (n == null) return '—';
  const v = +n;
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

// Vercel returns a plain-text/HTML error page (not JSON) for platform-level
// failures like function timeouts or crashes. res.json() throws a confusing
// "Unexpected token" error in that case — this reads the body safely and
// surfaces the real message instead.
async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.replace(/<[^>]+>/g, ' ').trim().slice(0, 160);
    return {
      error: `Server returned a non-JSON response (HTTP ${res.status}): ${
        snippet || 'empty body'
      }`,
    };
  }
}

function ProximityBar({ score, label }) {
  const s = Math.max(0, Math.min(100, Math.round(score || 0)));
  // green = close, yellow = mid, red-ish = far
  const color =
    s >= 75 ? '#0ecb81' : s >= 50 ? '#f0b90b' : s >= 25 ? '#f0a020' : '#f6465d';
  return (
    <div className="prox-bar">
      <div
        className="prox-fill"
        style={{ width: `${s}%`, background: color }}
      />
      <span className="prox-label">
        {label ? `${label} · ${s}%` : `${s}%`}
      </span>
    </div>
  );
}

function SignalCard({ s, kind }) {
  const dirCls = s.direction === 'LONG' ? 'long' : 'short';
  const conf = s.metadata?.conf || [];
  return (
    <div className={`signal-card ${dirCls}`}>
      <div className="card-head">
        <span className="sym">{s.symbol}</span>
        <span className={`dir ${dirCls}`}>
          {s.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT'}
        </span>
        <span className="score">{s.score}/100</span>
      </div>
      <div className="meta">
        {s.status || 'LIVE'} · Score {s.score}
        {s.distance_percent != null ? ` · Dist ${Number(s.distance_percent).toFixed(2)}%` : ''}
        {s.last_updated_at ? ` · ${s.last_updated_at.replace('T', ' ').slice(0, 19)} UTC` : ''}
      </div>
      <div className="levels">
        <div><span>Market (now)</span><span className="pos">{fmt(s.current_price ?? s.price)}</span></div>
        <div><span>Entry</span><span>{fmt(s.entry)}</span></div>
        {kind === 'ongoing' && (
          <div><span>Entry Hit</span><span>{fmt(s.entry_hit_price)}</span></div>
        )}
        {kind === 'ongoing' && (
          <div>
            <span>PnL</span>
            <span className={+s.current_pnl_percent >= 0 ? 'pos' : 'neg'}>
              {fmtPct(s.current_pnl_percent)}
            </span>
          </div>
        )}
        <div><span>SL</span><span className="neg">{fmt(s.sl)}</span></div>
        <div>
          <span>TP1 / TP2 / TP3</span>
          <span className="pos">
            {fmt(s.tp1)} {s.tp1_hit ? '✓' : ''} / {fmt(s.tp2)}{' '}
            {s.tp2_hit ? '✓' : ''} / {fmt(s.tp3)} {s.tp3_hit ? '✓' : ''}
          </span>
        </div>
        <div><span>R:R</span><span>1:{s.rr}</span></div>
      </div>
      <div className="proximity">
        <div className="prox-title">
          ENTRY PROXIMITY (ATR){' '}
          {s.close_label ? (
            <b style={{ color: s.is_close ? 'var(--green)' : 'var(--yellow)' }}>
              {s.close_label}
            </b>
          ) : null}
        </div>
        <ProximityBar score={s.proximity_score} label={s.close_label} />
        <div className="prox-meta">
          ATR dist: <b>{fmt(s.atr_distance, 2)}</b> ATR
          {' · '}
          Threshold: {fmt(s.ready_threshold_atr ?? 0.5, 2)} ATR
          {' · '}
          Price gap: {fmt(s.distance_percent, 2)}%
        </div>
      </div>
      {conf.length > 0 && (
        <div className="confluence">
          {conf.slice(0, 8).map((c, i) => (
            <span key={i}>✓ {c}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryRow({ h }) {
  return (
    <div className="hist-row">
      <b>{h.symbol}</b> {h.direction} · Score {h.score} ·{' '}
      <span className={h.status === 'COMPLETED_PROFIT' ? 'pos' : h.status === 'STOPPED' ? 'neg' : ''}>
        {h.status}
      </span>
      {' · '}
      PnL {fmtPct(h.current_pnl_percent)} · Entry {fmt(h.entry)} ·{' '}
      {h.completed_at?.replace('T', ' ').slice(0, 16) || h.last_updated_at?.slice(0, 16)}
    </div>
  );
}

function SetupRow({ s }) {
  const dirCls = s.dir === 'LONG' ? 'long' : 'short';
  return (
    <div className={`signal-card ${dirCls}`} style={{ opacity: s.qualifies ? 1 : 0.7 }}>
      <div className="card-head">
        <span className={`dir ${dirCls}`}>{s.dir === 'LONG' ? '🟢 LONG' : '🔴 SHORT'}</span>
        <span className="score">{s.score}/100</span>
        <span className={`badge ${s.qualifies ? '' : 'muted'}`} style={{ marginLeft: 'auto' }}>
          {s.qualifies ? '✅ QUALIFIES' : '❌ below threshold'}
        </span>
      </div>
      <div className="levels">
        <div><span>Entry</span><span>{fmt(s.entry)}</span></div>
        <div><span>SL</span><span className="neg">{fmt(s.sl)}</span></div>
        <div><span>TP1 / TP2 / TP3</span><span className="pos">{fmt(s.tp1)} / {fmt(s.tp2)} / {fmt(s.tp3)}</span></div>
        <div><span>R:R</span><span>1:{s.rr}</span></div>
      </div>
      {s.conf?.length > 0 && (
        <div className="confluence">
          {s.conf.map((c, i) => (
            <span key={i}>✓ {c}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalyzePanel() {
  const [symbolInput, setSymbolInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  const analyze = useCallback(async () => {
    if (!symbolInput.trim()) return;
    setLoading(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch(`/api/analyze?symbol=${encodeURIComponent(symbolInput.trim())}`);
      const data = await safeJson(res);
      if (!res.ok || data.error) setErr(data.error || 'Analysis failed');
      else setResult(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [symbolInput]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter') analyze();
  };

  return (
    <div className="section">
      <div className="section-header">🔎 ANALYZE ONE COIN</div>
      <div className="section-body">
        <div className="analyze-bar">
          <input
            className="analyze-input"
            placeholder="e.g. BTC or BTCUSDT"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button className="scan-btn" onClick={analyze} disabled={loading}>
            {loading ? '⏳ Analyzing…' : 'Analyze'}
          </button>
        </div>

        {err && <div className="muted small" style={{ color: 'var(--red)', marginTop: 10 }}>⚠️ {err}</div>}

        {result && (
          <div style={{ marginTop: 14 }}>
            <div className="flex" style={{ marginBottom: 10 }}>
              <div><b className="sym">{result.symbol}</b></div>
              <div>Price: <b>{fmt(result.price)}</b></div>
              <div>ATR(5m): <b>{fmt(result.atr5m)}</b></div>
              <div>Threshold to qualify: <b>{result.minScoreThreshold}/100</b></div>
            </div>

            <div className="flex muted small" style={{ marginBottom: 14 }}>
              <div>HTF Bias ({result.timeframes.htf}): <b>{result.context.structure?.bias ?? '—'}</b></div>
              <div>BOS: <b>{result.context.structure?.bos ?? '—'}</b></div>
              <div>CHOCH: <b>{result.context.structure?.choch ?? '—'}</b></div>
              <div>Zone: <b>{result.context.premiumDiscount?.zone ?? '—'}</b></div>
              <div>RSI: <b>{fmt(result.context.rsi, 1)}</b></div>
              <div>EMA20: <b>{fmt(result.context.ema20)}</b></div>
              <div>RVOL: <b>{fmt(result.context.relativeVolume, 2)}</b></div>
              <div>Order blocks found: <b>{result.context.orderBlocksFound}</b></div>
              <div>FVGs found: <b>{result.context.fvgsFound}</b></div>
            </div>

            {result.setups.length === 0 ? (
              <div className="muted">
                No order-block setups detected on {result.timeframes.obtf} right now — nothing for the strategy to score.
              </div>
            ) : (
              <div className="signal-grid">
                {result.setups.map((s, i) => (
                  <SetupRow key={i} s={s} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


function TelegramSettingsPanel() {
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/settings/telegram')
      .then((r) => r.json())
      .then((d) => setStatus(d))
      .catch(() => {});
  }, []);

  const save = async (withTest) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/settings/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bot_token: token,
          chat_id: chatId,
          test: withTest,
        }),
      });
      const data = await safeJson(res);
      if (!res.ok) {
        setMsg({ ok: false, text: data.error || 'Save failed' });
        return;
      }
      setStatus({
        configured: true,
        has_token: true,
        has_chat_id: true,
        source: 'database',
        token_preview: token.slice(0, 6) + '…',
        chat_id: chatId,
      });
      if (withTest && data.test && !data.test.ok && !data.test.skipped) {
        setMsg({ ok: false, text: 'Saved but test message failed — check token/chat id' });
      } else if (withTest) {
        setMsg({ ok: true, text: 'Saved + test message sent to Telegram' });
      } else {
        setMsg({ ok: true, text: 'Telegram settings saved' });
      }
      setToken('');
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="section">
      <div className="section-header">
        📱 TELEGRAM SETTINGS{' '}
        {status?.configured ? (
          <span className="badge live">CONNECTED</span>
        ) : (
          <span className="badge">NOT SET</span>
        )}
      </div>
      <div className="section-body">
        <p className="muted small" style={{ marginBottom: 12 }}>
          Vercel env ඕනේ නැහැ — මෙතනින් Bot Token + Chat ID දාන්න. Supabase{' '}
          <code>app_state</code> එකේ save වෙනවා.
        </p>
        {status?.configured && (
          <div className="muted small" style={{ marginBottom: 10 }}>
            Status: {status.source} · Token: {status.token_preview || '—'} · Chat:{' '}
            {status.chat_id || '—'}
          </div>
        )}
        <div className="analyze-bar" style={{ flexWrap: 'wrap', gap: 8 }}>
          <input
            className="analyze-input"
            type="password"
            placeholder="Bot token (from @BotFather)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{ minWidth: 220, flex: 1 }}
          />
          <input
            className="analyze-input"
            placeholder="Chat ID (number)"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            style={{ minWidth: 140 }}
          />
          <button className="scan-btn" disabled={busy || !token || !chatId} onClick={() => save(false)}>
            Save
          </button>
          <button className="scan-btn" disabled={busy || !token || !chatId} onClick={() => save(true)}>
            Save + Test
          </button>
        </div>
        {msg && (
          <div className={`muted small`} style={{ marginTop: 10, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>
            {msg.ok ? '✅' : '⚠️'} {msg.text}
          </div>
        )}
        <div className="muted small" style={{ marginTop: 12 }}>
          1) Telegram → @BotFather → /newbot → token copy
          <br />
          2) Bot එකට message එකක් යවන්න
          <br />
          3){' '}
          <code>https://api.telegram.org/botTOKEN/getUpdates</code> open කරලා{' '}
          <code>chat.id</code> ගන්න
        </div>
      </div>
    </div>
  );
}


export default function HomePage() {
  const [data, setData] = useState({
    ongoing: [],
    ready: [],
    watching: [],
    history: [],
    recent: [],
    lastScan: null,
    counts: {},
  });
  const [scanStatus, setScanStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState(null);
  const [scanProgress, setScanProgress] = useState(null);
  const [universe, setUniverse] = useState(50); // top N coins by volume
  const [liveSignals, setLiveSignals] = useState([]); // this scan only — live prices
  const [autoScanEnabled, setAutoScanEnabled] = useState(false);
  const [autoScanBusy, setAutoScanBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [sigRes, scanRes] = await Promise.all([
        fetch('/api/signals'),
        fetch('/api/scan'),
      ]);
      const sig = await safeJson(sigRes);
      const scan = await safeJson(scanRes);
      if (sig.error && !sig.ongoing) setError(sig.error);
      else setError(null);
      setData(sig);
      setScanStatus(scan);
      if (typeof scan.auto_scan_enabled === 'boolean') setAutoScanEnabled(scan.auto_scan_enabled);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Auto-refresh polling turned off — dashboard now updates only on
    // manual Scan Now / Analyze Coin actions, or a manual page reload.
  }, [refresh]);

  const toggleAutoScan = useCallback(async () => {
    setAutoScanBusy(true);
    try {
      const path = autoScanEnabled ? '/api/scan/stop' : '/api/scan/start';
      const res = await fetch(path, { method: 'POST' });
      const data = await safeJson(res);
      if (!res.ok) {
        setScanMsg({ ok: false, text: data.error || 'Toggle failed' });
        return;
      }
      setAutoScanEnabled(!!data.auto_scan_enabled);
      setScanMsg({
        ok: true,
        text: data.auto_scan_enabled
          ? 'Auto-scan ON — cron will run when scheduled (or external cron)'
          : 'Auto-scan OFF — cron will skip',
      });
    } catch (e) {
      setScanMsg({ ok: false, text: e.message });
    } finally {
      setAutoScanBusy(false);
    }
  }, [autoScanEnabled]);

  const scanNow = useCallback(async () => {
    setScanning(true);
    setScanMsg(null);
    setScanProgress(null);
    setLiveSignals([]);

    let totalChunks = 1;
    let chunkIndex = 1;
    let sumSymbols = 0;
    let sumCreated = 0;
    let sumTelegram = 0;
    let sumWatching = 0;
    let sumReady = 0;
    let sumOngoing = 0;
    let createdList = [];
    let totalMarket = null;
    let partialRetries = 0;
    const MAX_PARTIAL_RETRIES = 3;
    // Hobby-safe: ~15 symbols per request (~20–35s)
    const chunkSize = 15;

    try {
      let first = true;
      while (chunkIndex <= totalChunks) {
        setScanProgress({ chunk: chunkIndex, total: totalChunks, retrying: partialRetries > 0 });
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            universe: universe,
            chunkSize,
            resetCursor: first,
          }),
        });
        first = false;
        const result = await safeJson(res);

        if (!res.ok || result.error) {
          setScanMsg({ ok: false, text: result.error || 'Scan failed' });
          break;
        }
        if (result.skipped) {
          setScanMsg({ ok: false, text: result.reason || 'Scan already running — wait ~1 min' });
          break;
        }

        const got = result.symbolsScanned || 0;
        sumSymbols += got;
        sumCreated += result.signalsCreated || 0;
        sumTelegram += result.telegramSent || 0;
        if (result.watching_count != null) sumWatching = result.watching_count;
        if (result.ready_count != null) sumReady = result.ready_count;
        if (result.ongoing_count != null) sumOngoing = result.ongoing_count;
        if (Array.isArray(result.created)) createdList = createdList.concat(result.created);
        if (Array.isArray(result.liveSignals)) {
          createdList = createdList.concat(
            result.liveSignals.filter(
              (x) => !createdList.some((y) => y.signal_id === x.signal_id)
            )
          );
        }

        if (result.coverage) {
          totalChunks = result.coverage.cyclesToFullCoverage || 1;
          totalMarket = result.coverage.totalSymbols;
        } else {
          totalChunks = 1;
        }

        await refresh();

        // Soft timeout but some work done → cursor advanced; move to next chunk
        if (result.partial) {
          if (got > 0) {
            partialRetries = 0;
            if (chunkIndex >= totalChunks) {
              const map = new Map();
              for (const s of createdList) {
                if (!s?.signal_id) continue;
                const prev = map.get(s.signal_id);
                if (!prev || (s.score || 0) > (prev.score || 0)) map.set(s.signal_id, s);
              }
              const live = [...map.values()].sort((a, b) => {
                const da = a.atr_distance ?? 999;
                const db = b.atr_distance ?? 999;
                if (Math.abs(da - db) > 0.01) return da - db;
                return (b.score || 0) - (a.score || 0);
              });
              setLiveSignals(live);
              const closeN = live.filter((x) => x.is_close || (x.atr_distance != null && x.atr_distance <= 0.5)).length;
              setScanMsg({
                ok: true,
                text: `Done — ${sumSymbols} coins · ${live.length} signals · ${closeN} close · Telegram sent: ${sumTelegram} · Top ${universe}`,
              });
              break;
            }
            chunkIndex++;
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          partialRetries++;
          if (partialRetries > MAX_PARTIAL_RETRIES) {
            setScanMsg({
              ok: false,
              text: `Chunk ${chunkIndex}/${totalChunks} timed out with 0 symbols. Click Scan Now again. (Top ${universe})`,
            });
            break;
          }
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }

        partialRetries = 0;

        if (chunkIndex >= totalChunks) {
          const marketText = totalMarket
            ? ` — top ${totalMarket} coins fully scanned`
            : '';
          // Dedupe by signal_id, sort by score
          const map = new Map();
          for (const s of createdList) {
            if (!s?.signal_id) continue;
            const prev = map.get(s.signal_id);
            if (!prev || (s.score || 0) > (prev.score || 0)) map.set(s.signal_id, s);
          }
          const live = [...map.values()].sort((a, b) => {
            const da = a.atr_distance ?? 999;
            const db = b.atr_distance ?? 999;
            if (Math.abs(da - db) > 0.01) return da - db; // closest entry first
            return (b.score || 0) - (a.score || 0);
          });
          setLiveSignals(live);
          const closeN = live.filter((x) => x.is_close || (x.atr_distance != null && x.atr_distance <= 0.5)).length;
          setScanMsg({
            ok: true,
            text: `Done — ${sumSymbols} coins · ${live.length} signals · ${closeN} close to entry (sorted closest first) · Top ${universe}`,
          });
          break;
        }
        chunkIndex++;
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (e) {
      setScanMsg({ ok: false, text: e.message });
    } finally {
      setScanning(false);
      setScanProgress(null);
    }
  }, [refresh, universe]);

  const c = data.counts || {};
  const last = data.lastScan || scanStatus?.lastScan;

  return (
    <div className="app">
      <header className="header">
        <h1>BINANCE FUTURES HQ SIGNAL MONITOR</h1>
        <span className="badge live">SERVER SCANNER</span>
        <span className="badge">
          Last:{' '}
          {last?.completed_at
            ? last.completed_at.replace('T', ' ').slice(0, 19) + ' UTC'
            : '—'}
        </span>
        <span className="badge">
          Next: {scanStatus?.nextScan?.replace('T', ' ').slice(0, 16) || '—'}
        </span>
        <select
          className="scan-select"
          value={universe}
          disabled={scanning}
          onChange={(e) => setUniverse(+e.target.value)}
          title="Top N futures coins by 24h volume"
        >
          <option value={50}>Top 50</option>
          <option value={100}>Top 100</option>
          <option value={150}>Top 150</option>
          <option value={200}>Top 200</option>
          <option value={250}>Top 250</option>
        </select>
        <button
          className="scan-btn"
          onClick={scanNow}
          disabled={scanning}
        >
          {scanning
            ? scanProgress
              ? `⏳ ${scanProgress.chunk}/${scanProgress.total}${scanProgress.retrying ? ' retry' : ''}`
              : '⏳ Scanning…'
            : '🔍 Scan Now'}
        </button>

        <button
          className="scan-btn"
          onClick={toggleAutoScan}
          disabled={autoScanBusy}
          style={{
            background: autoScanEnabled ? 'var(--green)' : '#1e2329',
            color: autoScanEnabled ? '#000' : 'var(--text)',
          }}
          title="Arm/disarm server cron auto-scan"
        >
          {autoScanBusy
            ? '…'
            : autoScanEnabled
              ? '⏹ Auto-Scan ON'
              : '▶ Auto-Scan OFF'}
        </button>
<div className="counts">
          <span className="c-re">LIVE SIGNALS ({liveSignals.length})</span>
        </div>
      </header>

      <main className="main">
        {scanMsg && (
          <div className={`section scan-msg-box ${scanMsg.ok ? 'ok' : 'error-box'}`}>
            {scanMsg.ok ? '✅' : '⚠️'} {scanMsg.text}
          </div>
        )}
        {error && (
          <div className="section error-box">
            <b>Error:</b> {error}
            {process.env.NODE_ENV !== 'production' && (
              <div className="muted small">
                Dev tip: run without Supabase uses in-memory store. For production set SUPABASE_* env vars.
              </div>
            )}
          </div>
        )}

        <AnalyzePanel />
        <TelegramSettingsPanel />

        <div className="section">
          <div className="section-header">📊 SERVER STATUS</div>
          <div className="section-body flex">
            <div>
              Status:{' '}
              <b className="pos">
                {scanStatus?.dbReady ? 'ONLINE' : 'DB NOT READY'}
              </b>
            </div>
            <div>
              Symbols scanned (last): <b>{last?.symbols_scanned ?? '—'}</b>
            </div>
            <div>
              Created / Updated:{' '}
              <b>
                {last?.signals_created ?? 0} / {last?.signals_updated ?? 0}
              </b>
            </div>
            <div>
              Errors: <b>{last?.error_count ?? 0}</b>
            </div>
            <div className="muted small">
              HQ: 4H→1H · Conservative · Score≥70 · Cron every 5 min
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-header">
            🔥 LIVE SCAN SIGNALS ({liveSignals.length}) — current market prices · this scan only
          </div>
          <div className="section-body">
            {scanning ? (
              <div className="muted">Scanning… signals appear when done.</div>
            ) : !liveSignals.length ? (
              <div className="muted">
                Scan Now click කරන්න. Score ≥ 70 setups මෙහෙම live price එක්ක පෙනෙයි.
                DB එකේ පරණ WATCHING pile එකක් නැහැ.
              </div>
            ) : (
              <div className="signal-grid">
                {liveSignals.map((s) => (
                  <SignalCard key={s.signal_id || s.symbol + s.direction} s={s} kind="ready" />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="section">
          <div className="section-header">📜 SIGNAL HISTORY</div>
          <div className="section-body">
            {!data.history?.length ? (
              <div className="muted">No history yet.</div>
            ) : (
              data.history.slice(0, 50).map((h) => (
                <HistoryRow key={h.signal_id || h.id} h={h} />
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
