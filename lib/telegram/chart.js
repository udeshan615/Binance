/**
 * Generate a signal chart image URL via QuickChart.io (no native deps).
 * Shows recent closes + horizontal lines for Entry / SL / TPs / OB zone.
 */
import { SIGNAL_CONFIG } from '../config/signalConfig.js';
import { getKlines } from '../binance/client.js';

function fmt(n, d = 4) {
  if (n == null || Number.isNaN(+n)) return null;
  return +Number(n).toFixed(d);
}

/**
 * @returns {Promise<string|null>} PNG image URL or null
 */
export async function generateSignalChartImage(signal, candles) {
  try {
    let data = candles;
    if (!data?.length) {
      const tf = SIGNAL_CONFIG.obTf || '1h';
      data = await getKlines(signal.symbol, tf, 60);
    }
    if (!data?.length) return null;

    // Use last ~48 bars for speed/clarity
    const slice = data.slice(-48);
    const labels = slice.map((_, i) => String(i + 1));
    const closes = slice.map((c) => c.close);

    const entry = fmt(signal.entry);
    const sl = fmt(signal.sl);
    const tp1 = fmt(signal.tp1);
    const tp2 = fmt(signal.tp2);
    const tp3 = fmt(signal.tp3);
    const cur = fmt(signal.current_price ?? signal.price);
    const obLow = fmt(signal.ob_low ?? signal.ob?.low ?? signal.metadata?.ob?.low);
    const obHigh = fmt(signal.ob_high ?? signal.ob?.high ?? signal.metadata?.ob?.high);

    const annotations = {};
    const addLine = (id, y, color, label) => {
      if (y == null) return;
      annotations[id] = {
        type: 'line',
        yMin: y,
        yMax: y,
        borderColor: color,
        borderWidth: 2,
        borderDash: id.startsWith('tp') ? [4, 4] : undefined,
        label: {
          display: true,
          content: label,
          position: 'start',
          backgroundColor: color,
          color: '#fff',
          font: { size: 10 },
        },
      };
    };

    if (obLow != null && obHigh != null) {
      annotations.ob = {
        type: 'box',
        yMin: Math.min(obLow, obHigh),
        yMax: Math.max(obLow, obHigh),
        backgroundColor: 'rgba(240, 185, 11, 0.15)',
        borderColor: 'rgba(240, 185, 11, 0.6)',
        borderWidth: 1,
      };
    }
    addLine('entry', entry, '#1e90ff', 'ENTRY');
    addLine('sl', sl, '#f6465d', 'SL');
    addLine('tp1', tp1, '#0ecb81', 'TP1');
    addLine('tp2', tp2, '#3fb950', 'TP2');
    addLine('tp3', tp3, '#56d364', 'TP3');
    addLine('cur', cur, '#eaecef', 'NOW');

    const config = {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: signal.symbol,
            data: closes,
            borderColor: signal.direction === 'SHORT' ? '#f6465d' : '#0ecb81',
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.1,
          },
        ],
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: `${signal.symbol} ${signal.direction} · Score ${signal.score ?? '—'}`,
            color: '#eaecef',
            font: { size: 14 },
          },
          legend: { display: false },
          annotation: { annotations },
        },
        scales: {
          x: {
            ticks: { display: false },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            ticks: { color: '#848e9c', font: { size: 10 } },
            grid: { color: 'rgba(255,255,255,0.08)' },
          },
        },
      },
    };

    const params = new URLSearchParams({
      c: JSON.stringify(config),
      backgroundColor: 'rgb(13,17,23)',
      width: '800',
      height: '420',
      devicePixelRatio: '2',
      version: '4',
    });

    // QuickChart returns PNG at this URL — Telegram can fetch it
    return `https://quickchart.io/chart?${params.toString()}`;
  } catch (e) {
    console.error('[chart]', e.message);
    return null;
  }
}
