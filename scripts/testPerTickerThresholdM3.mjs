/**
 * Prueba OFFLINE (no toca engine.ts ni DensityLab.tsx) de otra variante
 * de M3: mantiene el ranking de M2 (elige el ticker de mayor delta de
 * ICD CRUDO, igual que siempre -- no cambia el "quien gana"), pero exige
 * que ese ganador supere SU PROPIO umbral historico antes de dejar
 * entrar -- umbral = media movil + k*desvio movil del delta de ESE
 * ticker especifico (ventana propia, no uno fijo igual para todos).
 *
 * Diferencia con la prueba anterior (z-score global,
 * testRelativeDeltaM3.mjs): ahi el RANKING cambiaba (ganaba el mayor
 * z-score, podia ser un sector calmo con un tic chico). Aca el ranking
 * sigue siendo el de M2 (mayor delta crudo) -- solo se agrega un piso de
 * calificacion individual por ticker antes de aceptar la entrada. Un
 * sector historicamente volatil (ej. Energia) necesita un delta mas
 * grande en numero absoluto para calificar; uno historicamente calmo
 * (ej. Servicios Publicos) califica con un delta mas chico -- cada uno
 * segun como se mueve el mismo, no un piso parejo para todos.
 *
 * Prueba con ventana de estadistica propia de 60 dias y varios k, en
 * Backtest, Validacion y Live con los defaults de produccion.
 *
 * Correr con:
 *   node --experimental-strip-types scripts/testPerTickerThresholdM3.mjs
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
const STAT_WINDOW = 60;
const K_VALUES = [0, 0.25, 0.5, 1.0];

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

/** Delta de ICD (lookbackDays) por fecha, para un ticker. */
function deltaMap(rows, lookbackDays) {
  const icdByDate = new Map(rows.map((r) => [r.date, r.ICD]));
  const dates = rows.map((r) => r.date);
  const m = new Map();
  for (let i = lookbackDays; i < dates.length; i++) {
    const now = icdByDate.get(dates[i]);
    const before = icdByDate.get(dates[i - lookbackDays]);
    if (now === null || now === undefined || before === null || before === undefined) continue;
    m.set(dates[i], now - before);
  }
  return m;
}

/** Umbral propio del ticker: media movil + k*desvio movil de SU delta. */
function ownThresholdMap(rows, lookbackDays, statWindow, k) {
  const deltas = deltaMap(rows, lookbackDays);
  const dates = [...deltas.keys()].sort();
  const vals = dates.map((d) => deltas.get(d));
  const thr = new Map();
  for (let i = statWindow - 1; i < dates.length; i++) {
    const window = vals.slice(i - statWindow + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / (window.length - 1);
    const std = Math.sqrt(variance);
    thr.set(dates[i], mean + k * std);
  }
  return thr;
}

/**
 * Igual ranking que M2 (mayor delta crudo gana), pero solo entra si el
 * ganador supera SU umbral propio (media+k*std de su propio historial de
 * deltas). Si no califica, se queda en cash.
 */
function simulateOwnThreshold(sectorMetrics, lookbackDays, statWindow, k) {
  const tickers = Object.keys(sectorMetrics).filter((t) => sectorMetrics[t].some((r) => r.ICD !== null));
  if (tickers.length === 0) return [];

  const deltaByTicker = {};
  const thresholdByTicker = {};
  const closeByTicker = {};
  const icdByTicker = {};
  for (const t of tickers) {
    deltaByTicker[t] = deltaMap(sectorMetrics[t], lookbackDays);
    thresholdByTicker[t] = ownThresholdMap(sectorMetrics[t], lookbackDays, statWindow, k);
    closeByTicker[t] = new Map(sectorMetrics[t].map((r) => [r.date, r.close]));
    icdByTicker[t] = new Map(sectorMetrics[t].map((r) => [r.date, r.ICD]));
  }

  const dateSet = new Set();
  for (const t of tickers) for (const r of sectorMetrics[t]) dateSet.add(r.date);
  const dates = Array.from(dateSet).sort();

  function pickBestQualifying(date) {
    let bestTicker = null;
    let bestDelta = -Infinity;
    for (const t of tickers) {
      const delta = deltaByTicker[t].get(date);
      const threshold = thresholdByTicker[t].get(date);
      if (delta === undefined || threshold === undefined) continue;
      if (delta < threshold) continue; // no califica para SU propio umbral
      if (delta > bestDelta) {
        bestDelta = delta;
        bestTicker = t;
      }
    }
    return bestTicker;
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
      const bestTicker = pickBestQualifying(date);
      if (bestTicker !== null) {
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
    console.log('  M2 (piso global fijo=ninguno): ' + fmt(computeStrategyStats(curveM2), curveM2));

    for (const k of K_VALUES) {
      const curve = simulateOwnThreshold(win, LOOKBACK_DAYS, STAT_WINDOW, k);
      console.log(`  M3 umbral propio (k=${k}):`.padEnd(32) + fmt(computeStrategyStats(curve), curve));
    }

    const spyWindow = priceBars.SPY.filter((b) => b.date >= start && (end === null || b.date <= end));
    const spyCurve = buyAndHoldCurve(spyWindow, curveM2.map((p) => p.date));
    console.log('  SPY buy&hold:                  ' + fmt(computeStrategyStats(spyCurve), spyCurve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
