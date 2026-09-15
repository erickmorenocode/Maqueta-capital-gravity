/**
 * Prueba OFFLINE (no toca engine.ts ni DensityLab.tsx) de un filtro de
 * confirmacion de tendencia sobre la salida de M2: en vez de salir apenas
 * ICD < 0, sale SOLO si ICD < 0 Y ADEMAS el precio de cierre esta por
 * debajo de su propia media movil corta (SMA_N) -- no corta posiciones
 * que siguen subiendo en precio aunque el ICD titile por ruido de
 * volumen.
 *
 * Motivado por: XLE subio 44.2% YTD en la ventana Live (2026) pero M2
 * solo estuvo posicionado 29 de 251 dias (11 entradas/salidas, casi
 * todas de 1-4 dias, neto -6.0%) -- el ICD (volumen-normalizado) oscila
 * independiente del precio, la salida ICD<0 lo saca en cada titileo.
 *
 * Prueba en Backtest, Validacion Y Live (no solo la anecdota de XLE) con
 * varios SMA_N, comparado contra M2 sin filtro (default actual:
 * rollingWindow=42, lookback=9, universo 13).
 *
 * Correr con:
 *   node --experimental-strip-types scripts/testTrendConfirmM2.mjs
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
const SMA_WINDOWS = [5, 10, 20];

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

function smaMap(rows, window) {
  const closes = rows.map((r) => r.close);
  const map = new Map();
  for (let i = window - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) sum += closes[j];
    map.set(rows[i].date, sum / window);
  }
  return map;
}

/**
 * M2 + confirmacion de tendencia: sale SOLO si ICD<0 Y close < SMA_N del
 * mismo ticker. Si el precio sigue sobre su media movil, aguanta la
 * posicion aunque el ICD haya cruzado a negativo.
 */
function simulateIcdExitTrendConfirm(sectorMetrics, lookbackDays, smaWindow) {
  const tickers = Object.keys(sectorMetrics).filter((t) => sectorMetrics[t].some((r) => r.ICD !== null));
  if (tickers.length === 0) return [];

  const dateSet = new Set();
  for (const t of tickers) for (const r of sectorMetrics[t]) dateSet.add(r.date);
  const dates = Array.from(dateSet).sort();

  const icdByTicker = {};
  const closeByTicker = {};
  const smaByTicker = {};
  for (const t of tickers) {
    icdByTicker[t] = new Map(sectorMetrics[t].map((r) => [r.date, r.ICD]));
    closeByTicker[t] = new Map(sectorMetrics[t].map((r) => [r.date, r.close]));
    smaByTicker[t] = smaMap(sectorMetrics[t], smaWindow);
  }

  function pickBestTicker(date, lookbackDate) {
    let bestTicker = null;
    let bestDelta = -Infinity;
    for (const t of tickers) {
      const now = icdByTicker[t].get(date);
      const before = icdByTicker[t].get(lookbackDate);
      if (now === null || now === undefined || before === null || before === undefined) continue;
      const delta = now - before;
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
      const smaNow = smaByTicker[position.ticker].get(date);
      const icdNegative = icdNow !== null && icdNow !== undefined && icdNow < 0;
      const belowTrend = smaNow !== undefined && closeNow !== undefined && closeNow < smaNow;
      if (icdNegative && belowTrend && closeNow !== undefined) {
        equityValue *= 1 + (closeNow / position.entryPrice - 1);
        equity.push({ date, value: equityValue });
        position = null;
      }
    }

    if (!position) {
      const lookbackDate = dates[i - lookbackDays];
      const bestTicker = pickBestTicker(date, lookbackDate);
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
    console.log('  M2 sin filtro (actual):  ' + fmt(computeStrategyStats(curveM2), curveM2));

    for (const smaN of SMA_WINDOWS) {
      const curveTrend = simulateIcdExitTrendConfirm(win, LOOKBACK_DAYS, smaN);
      console.log(`  M2 + SMA${String(smaN).padStart(2)} confirm:      ` + fmt(computeStrategyStats(curveTrend), curveTrend));
    }

    const spyWindow = priceBars.SPY.filter((b) => b.date >= start && (end === null || b.date <= end));
    const spyCurve = buyAndHoldCurve(spyWindow, curveM2.map((p) => p.date));
    console.log('  SPY buy&hold:            ' + fmt(computeStrategyStats(spyCurve), spyCurve));
  }

}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
