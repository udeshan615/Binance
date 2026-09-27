/**
 * Telegram notifications — text + optional chart photo for READY / ENTRY_HIT.
 * Credentials: env vars OR app_state (set from site UI).
 */
import { generateSignalChartImage } from './chart.js';
import { getState } from '../database/appState.js';

async function getTelegramConfig() {
  let token = process.env.TELEGRAM_BOT_TOKEN || '';
  let chatId = process.env.TELEGRAM_CHAT_ID || '';
  try {
    const stored = await getState('telegram_config', null);
    if (stored && typeof stored === 'object') {
      if (stored.bot_token) token = stored.bot_token;
      if (stored.chat_id) chatId = String(stored.chat_id);
    }
  } catch (_) {}
  return { token, chatId };
}

async function configured() {
  const { token, chatId } = await getTelegramConfig();
  return !!(token && chatId);
}

export async function sendTelegramMessage(text) {
  const { token, chatId } = await getTelegramConfig();
  if (!token || !chatId) {
    console.warn('[Telegram] Not configured — skip send');
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      }
    );
    const data = await res.json();
    if (!data.ok) {
      console.error('[Telegram] API error', data);
      return { ok: false, error: data };
    }
    return { ok: true };
  } catch (e) {
    console.error('[Telegram] Network error', e.message);
    return { ok: false, error: e.message };
  }
}

function truncateCaption(html, max = 1000) {
  if (!html || html.length <= max) return html;
  return html.slice(0, max - 20) + '\n…';
}

export async function sendPhotoMessage(caption, imageUrlOrBuffer) {
  const { token, chatId } = await getTelegramConfig();
  if (!token || !chatId) {
    console.warn('[Telegram] Not configured — skip photo');
    return { ok: false, skipped: true };
  }
  if (!imageUrlOrBuffer) {
    return sendTelegramMessage(caption);
  }

  const cap = truncateCaption(caption);

  try {
    if (typeof imageUrlOrBuffer === 'string') {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendPhoto`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            photo: imageUrlOrBuffer,
            caption: cap,
            parse_mode: 'HTML',
          }),
        }
      );
      const data = await res.json();
      if (!data.ok) {
        console.error('[Telegram] sendPhoto error', data);
        return sendTelegramMessage(caption);
      }
      return { ok: true, photo: true };
    }

    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', cap);
    form.append('parse_mode', 'HTML');
    form.append(
      'photo',
      new Blob([imageUrlOrBuffer], { type: 'image/png' }),
      'chart.png'
    );
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendPhoto`,
      { method: 'POST', body: form }
    );
    const data = await res.json();
    if (!data.ok) {
      console.error('[Telegram] sendPhoto buffer error', data);
      return sendTelegramMessage(caption);
    }
    return { ok: true, photo: true };
  } catch (e) {
    console.error('[Telegram] photo network error', e.message);
    return sendTelegramMessage(caption);
  }
}

function fmt(n, d = 4) {
  if (n == null || Number.isNaN(+n)) return '—';
  return Number(n).toFixed(d);
}

function confLines(signal) {
  const conf = signal.metadata?.conf || signal.conf || [];
  if (!conf.length) return '';
  return conf.map((c) => `• ${c}`).join('\n');
}

/** Full analyze-style caption (Telegram photo caption max ~1024) */
function buildFullCaption(title, signal) {
  const meta = signal.metadata || {};
  const st = signal.structure || meta.structure || {};
  const pd = signal.pd || meta.pd || {};
  const conf = confLines(signal);
  const htf = meta.htf || '4h';
  const obtf = meta.obTf || '1h';
  const style = meta.entryStyle || 'conservative';
  const close =
    signal.close_label ||
    (signal.atr_distance != null && signal.atr_distance <= 0.5
      ? 'CLOSE'
      : 'WATCH');
  const rvol = signal.rvol ?? meta.rvol;
  const price = signal.current_price ?? signal.price;

  let text = `${title}

<b>${signal.symbol}</b> ${signal.direction} · Score <b>${signal.score}/100</b>
${close} · ATR ${fmt(signal.atr_distance, 2)} (≤0.5 = close)

<b>Prices</b>
Market: ${fmt(price)}
Entry: ${fmt(signal.entry)}
SL: ${fmt(signal.sl)}
TP1: ${fmt(signal.tp1)} · TP2: ${fmt(signal.tp2)} · TP3: ${fmt(signal.tp3)}
R:R 1:${signal.rr}
Gap: ${fmt(signal.distance_percent, 2)}% · ${fmt(signal.distance_to_entry)}

<b>Analysis (${htf}→${obtf} · ${style})</b>
Bias: ${st.bias ?? '—'} · BOS: ${st.bos ?? '—'} · CHOCH: ${st.choch ?? '—'}
Zone: ${pd.zone ?? '—'} · RVOL: ${rvol != null ? Number(rvol).toFixed(2) : '—'}
OB: ${fmt(signal.ob_low)} – ${fmt(signal.ob_high)}
`;

  if (conf) text += `\n<b>Confluence</b>\n${conf}\n`;
  text += `\n${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`;
  return text;
}

export async function sendReadyNotification(signal) {
  const text = buildFullCaption('🟡 <b>READY / CLOSE TO ENTRY</b>', signal);
  try {
    const chartUrl = await generateSignalChartImage(signal);
    return sendPhotoMessage(text, chartUrl);
  } catch (e) {
    console.error('[Telegram] READY chart failed', e.message);
    return sendTelegramMessage(text);
  }
}

export async function sendEntryNotification(signal) {
  const base = buildFullCaption('🟢 <b>ENTRY HIT / ONGOING</b>', signal);
  const extra = signal.entry_hit_price
    ? `\nEntry hit @ ${fmt(signal.entry_hit_price)}`
    : '';
  const text = base + extra;
  try {
    const chartUrl = await generateSignalChartImage(signal);
    return sendPhotoMessage(text, chartUrl);
  } catch (e) {
    console.error('[Telegram] ENTRY chart failed', e.message);
    return sendTelegramMessage(text);
  }
}

export async function sendTPNotification(level, signal) {
  const icons = { TP1: '✅', TP2: '✅', TP3: '🏆' };
  const title =
    level === 'TP3'
      ? `${icons.TP3} TP3 HIT — SIGNAL COMPLETED`
      : `${icons[level]} ${level} HIT`;
  const text = `${title}

<b>${signal.symbol}</b> ${signal.direction}

Entry: ${fmt(signal.entry_hit_price || signal.entry)}
Current: ${fmt(signal.current_price)}
PnL: ${fmt(signal.current_pnl_percent, 2)}%

SL: ${fmt(signal.sl)}
TP1: ${fmt(signal.tp1)} ${signal.tp1_hit ? '✓' : ''}
TP2: ${fmt(signal.tp2)} ${signal.tp2_hit ? '✓' : ''}
TP3: ${fmt(signal.tp3)} ${signal.tp3_hit ? '✓' : ''}`;
  return sendTelegramMessage(text);
}

export async function sendSLNotification(signal) {
  const text = `🛑 <b>STOP LOSS HIT</b>

<b>${signal.symbol}</b> ${signal.direction}

Entry: ${fmt(signal.entry_hit_price || signal.entry)}
SL: ${fmt(signal.sl)}
Exit: ${fmt(signal.current_price)}
PnL: ${fmt(signal.current_pnl_percent, 2)}%

Score: ${signal.score}`;
  return sendTelegramMessage(text);
}

export async function sendInvalidationNotification(signal) {
  const text = `⚪ <b>SIGNAL INVALIDATED</b>

<b>${signal.symbol}</b> ${signal.direction}

Entry: ${fmt(signal.entry)}
Current: ${fmt(signal.current_price)}
Score: ${signal.score}

Status: INVALIDATED`;
  return sendTelegramMessage(text);
}

export async function dispatchNotifications(notifications) {
  const results = [];
  for (const n of notifications) {
    let res;
    if (n.type === 'READY') res = await sendReadyNotification(n.signal);
    else if (n.type === 'ENTRY_HIT') res = await sendEntryNotification(n.signal);
    else if (n.type === 'TP1') res = await sendTPNotification('TP1', n.signal);
    else if (n.type === 'TP2') res = await sendTPNotification('TP2', n.signal);
    else if (n.type === 'TP3') res = await sendTPNotification('TP3', n.signal);
    else if (n.type === 'SL') res = await sendSLNotification(n.signal);
    else if (n.type === 'INVALIDATED')
      res = await sendInvalidationNotification(n.signal);
    else res = { ok: false, skipped: true };
    results.push({ type: n.type, signalId: n.signal.signal_id, ...res });
  }
  return results;
}

/** Test message — used by settings UI */
export async function sendTestMessage() {
  return sendTelegramMessage(
    `✅ <b>HQ Monitor connected</b>\nTime: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`
  );
}
