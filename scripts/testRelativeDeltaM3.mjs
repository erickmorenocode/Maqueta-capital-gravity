/**
 * Prueba OFFLINE (no toca engine.ts ni DensityLab.tsx) de otra variante
 * de Metodologia 3: en vez de comparar el delta de ICD CRUDO entre
 * tickers (M2 actual -- compara numeros en escalas potencialmente
 * distintas, un sector historicamente mas movido en ICD gana por
 * default aunque su movimiento actual no sea inusual PARA EL), normaliza
 * cada delta por la distribucion historica PROPIA de ese ticker: z-score
 * del delta respecto a su propia media/desvio movil. Elige el ticker con
 * mayor z-score (el que se mueve mas inusual PARA SI MISMO), no el de
 * mayor numero crudo.
 *
 * Misma regla de salida que M2 (ICD<0) -- se aisla el cambio a la regla
 * de ENTRADA solamente.
 *
 * Prueba con ventana de normalizacion de 60 dias (referencia: ~3 meses
 * de historial propio de cada ticker) y varios pisos de zDelta minimo,
 * en Backtest, Validacion y Live con los defaults de produccion
 * (rollingWindow=42, lookbackDays=9, universo 13).
 *
 * Correr con:
 *   node --experimental-strip-types scripts/testRelativeDeltaM3.mjs
 */

import YahooFinance from 'yahoo-finance2';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engine = await import('../src/lib/densityLab/engine.ts');

const {
  SECTOR_ETFS,
  BACKTEST_START,
  BACKTEST_END,
  VALIDATION_START,
  VALIDATION_END,
  LIVE_START,
  computeAllSectorsDensity,
  sliceWindow,
  simulateIcdExitStrategy,
  computeStrategyStats,
  buyAndHoldCurve,
} = engine;

const ROLLING_WINDOW = 42;
const LOOKBACK_DAYS = 9;
const FREE_FLOAT_RATIO = 0.95;
const DELTA_NORM_WINDOW = 60;
const MIN_Z_DELTAS = [-Infinity, 0, 0.5, 1.0];

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

async function downloadPriceHistory(ticker, start, end) {
  try {
    const res = await yf.chart(ticker, { period1: start, period2: end, interval: '1d' });
    return res.quotes
      .filter((q) => q.close !== null && q.close !== undefined && q.volume !== null && q.volume !== undefined)
      .map((q) => ({
        date: q.date.toISOString().slice(0, 10),
        open: q.open ?? q.close,
        high: q.high ?? q.close,
        low: q.low ?? q.close,
        close: q.adjclose ?? q.close,
        volume: q.volume,
      }));
  } catch {
    return [];
  }
}

/**
 * Para cada ticker: serie de deltas de ICD (lookbackDays), luego z-score
 * de cada delta respecto a la media/desvio movil PROPIO de esa serie de
 * deltas (ventana deltaNormWindow). Devuelve Map(date -> zDelta) por
 * ticker.
 */
function buildZDeltaByTicker(sectorMetrics, lookbackDays, deltaNormWindow) {
  const zByTicker = {};
  for (const [ticker, rows] of Object.entries(sectorMetrics)) {
    const icdByDate = new Map(rows.map((r) => [r.date, r.ICD]));
    const dates = rows.map((r) => r.date);
    const deltas = dates.map((d, i) => {
      if (i < lookbackDays) return null;
      const now = icdByDate.get(d);
      const before = icdByDate.get(dates[i - lookbackDays]);
      if (now === null || now === undefined || before === null || before === undefined) return null;
      return now - before;
    });

    const z = new Map();
    for (let i = 0; i < dates.length; i++) {
      if (i < deltaNormWindow) continue;
      const window = deltas.slice(i - deltaNormWindow + 1, i + 1);
      if (window.some((v) => v === null)) continue;
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / (window.length - 1);
      const std = Math.sqrt(variance);
      const cur = deltas[i];
      if (cur === null || std === 0) continue;
      z.set(dates[i], (cur - mean) / std);
    }
    zByTicker[ticker] = z;
  }
  return zByTicker;
}

/**
 * Igual que simulateIcdExitStrategy (M2) pero elige por zDelta relativo
 * (por ticker) en vez de delta crudo. minZDelta = piso minimo para
 * entrar (-Infinity = siempre entra al mejor, igual que M2 en espiritu
 * pero con ranking distinto).
 */
function simulateRelativeDelta(sectorMetrics, lookbackDays, deltaNormWindow, minZDelta) {
  const tickers = Object.keys(sectorMetrics).filter((t) => sectorMetrics[t].some((r) => r.ICD !== null));
  if (tickers.length === 0) return [];

  const zByTicker = buildZDeltaByTicker(sectorMetrics, lookbackDays, deltaNormWindow);

  const dateSet = new Set();
  for (const t of tickers) for (const r of sectorMetrics[t]) dateSet.add(r.date);
  const dates = Array.from(dateSet).sort();

  const icdByTicker = {};
  const closeByTicker = {};
  for (const t of tickers) {
    icdByTicker[t] = new Map(sectorMetrics[t].map((r) => [r.date, r.ICD]));
    closeByTicker[t] = new Map(sectorMetrics[t].map((r) => [r.date, r.close]));
  }

  function pickBestTicker(date) {
    let bestTicker = null;
    let bestZ = -Infinity;
    for (const t of tickers) {
      const z = zByTicker[t].get(date);
      if (z === undefined) continue;
      if (z > bestZ) {
        bestZ = z;
        bestTicker = t;
      }
    }
    return { bestTicker, bestZ };
  }

  const equity = [];
  let equityValue = 1.0;
  let position = null;

  for (let i = lookbackDays; i < dates.length; i++) {
    const date = dates[i];

    if (position) {
      const icdNow = icdByTicker[position.ticker].get(date);
      const closeNow = closeByTicker[position.ticker].get(date);
      if (icdNow !== null && icdNow !== undefined && icdNow < 0 && closeNow !== undefined) {
        equityValue *= 1 + (closeNow / position.entryPrice - 1);
        equity.push({ date, value: equityValue });
        position = null;
      }
    }

    if (!position) {
      const { bestTicker, bestZ } = pickBestTicker(date);
      if (bestTicker !== null && bestZ >= minZDelta) {
        const entryPrice = closeByTicker[bestTicker].get(date);
        if (entryPrice !== undefined) {
          position = { ticker: bestTicker, entryPrice };
          if (equity.length === 0) equity.push({ date, value: 1.0 });
        }
      }
    }
  }

  if (position) {
    const lastDate = dates[dates.length - 1];
    const lastClose = closeByTicker[position.ticker].get(lastDate);
    if (lastClose !== undefined) {
      equityValue *= 1 + (lastClose / position.entryPrice - 1);
      equity.push({ date: lastDate, value: equityValue });
    }
  }

  return equity.length >= 2 ? equity : [];
}

function fmt(stats, curve) {
  const gain = curve.length >= 2 ? ((curve[curve.length - 1].value / curve[0].value - 1) * 100).toFixed(1) + '%' : 'n/a';
  const sharpe = stats.sharpe !== null ? stats.sharpe.toFixed(2) : 'n/a';
  const pf = stats.profitFactor === null ? 'n/a' : stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2);
  const rb = stats.riskReward !== null ? stats.riskReward.toFixed(2) : 'n/a';
  return `trades=${String(stats.trades).padStart(3)} sharpe=${sharpe.padStart(5)} PF=${pf.padStart(5)} R:B=${rb.padStart(5)} gain=${gain.padStart(8)}`;
}

async function main() {
  const allTickers = [...SECTOR_ETFS, 'SPY'];
  const today = new Date().toISOString().slice(0, 10);
  console.log(`Descargando OHLCV ${BACKTEST_START} -> ${today} para ${allTickers.length} tickers...`);
  const priceResults = await Promise.all(allTickers.map((t) => downloadPriceHistory(t, BACKTEST_START, today)));
  const priceBars = {};
  allTickers.forEach((t, i) => {
    if (priceResults[i].length > 0) priceBars[t] = priceResults[i];
  });

  const historicalSize = JSON.parse(readFileSync(path.join(__dirname, '../src/lib/densityLab/historicalSize.json'), 'utf8'));
  const sectorBars = {};
  for (const t of SECTOR_ETFS) if (priceBars[t]) sectorBars[t] = priceBars[t];

  const fullMetrics = computeAllSectorsDensity(sectorBars, historicalSize, FREE_FLOAT_RATIO, ROLLING_WINDOW);

  for (const [label, start, end] of [
    ['BACKTEST (2018-2023)', BACKTEST_START, BACKTEST_END],
    ['VALIDACION (2024-2025)', VALIDATION_START, VALIDATION_END],
    ['LIVE (2026-presente)', LIVE_START, null],
  ]) {
    console.log(`\n=== ${label} ===`);
    const win = {};
    for (const [t, rows] of Object.entries(fullMetrics)) win[t] = sliceWindow(rows, start, end);

    const curveM2 = simulateIcdExitStrategy(win, LOOKBACK_DAYS);
    console.log('  M2 delta crudo (actual): ' + fmt(computeStrategyStats(curveM2), curveM2));

    for (const minZ of MIN_Z_DELTAS) {
      const curve = simulateRelativeDelta(win, LOOKBACK_DAYS, DELTA_NORM_WINDOW, minZ);
      const label2 = minZ === -Infinity ? 'sin piso' : `minZ=${minZ}`;
      console.log(`  M3 zDelta relativo (${label2}):`.padEnd(28) + fmt(computeStrategyStats(curve), curve));
    }

    const spyWindow = priceBars.SPY.filter((b) => b.date >= start && (end === null || b.date <= end));
    const spyCurve = buyAndHoldCurve(spyWindow, curveM2.map((p) => p.date));
    console.log('  SPY buy&hold:             ' + fmt(computeStrategyStats(spyCurve), spyCurve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
