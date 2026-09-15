/**
 * Prueba OFFLINE (no toca engine.ts ni DensityLab.tsx) de M3 usando
 * volatilidad de PRECIO propia (no de ICD -- ya probamos que el ICD
 * viene pre-normalizado igual para todos los sectores, ver
 * testPerTickerThresholdM3.mjs, no sirve para diferenciar).
 *
 * Mantiene el ranking de M2 (elige el ticker de mayor delta de ICD), pero
 * exige ADEMAS que el retorno de PRECIO de ese ticker en los ultimos
 * lookbackDays supere k * su propia volatilidad diaria historica
 * escalada a ese periodo (sigma_lookback = volDiaria * sqrt(lookbackDays))
 * -- confirmacion de que el movimiento de PRECIO es genuinamente grande
 * PARA ESE sector especifico, no solo que el ICD lo marco.
 *
 * Prueba con ventana de volatilidad de 60 dias y varios k, en Backtest,
 * Validacion y Live con los defaults de produccion.
 *
 * Correr con:
 *   node --experimental-strip-types scripts/testPriceVolFilterM3.mjs
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
const VOL_WINDOW = 60;
const K_VALUES = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4];

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

/** Volatilidad diaria movil (desvio de retornos diarios) por fecha. */
function dailyVolMap(rows, volWindow) {
  const closes = rows.map((r) => r.close);
  const rets = [];
  for (let i = 1; i < closes.length; i++) rets.push(closes[i] / closes[i - 1] - 1);
  const map = new Map();
  for (let i = volWindow - 1; i < rets.length; i++) {
    const window = rets.slice(i - volWindow + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / (window.length - 1);
    map.set(rows[i + 1].date, Math.sqrt(variance));
  }
  return map;
}

/** Retorno de precio crudo sobre lookbackDays, por fecha. */
function priceReturnMap(rows, lookbackDays) {
  const closeByDate = new Map(rows.map((r) => [r.date, r.close]));
  const dates = rows.map((r) => r.date);
  const map = new Map();
  for (let i = lookbackDays; i < dates.length; i++) {
    const now = closeByDate.get(dates[i]);
    const before = closeByDate.get(dates[i - lookbackDays]);
    if (now === undefined || before === undefined || before === 0) continue;
    map.set(dates[i], now / before - 1);
  }
  return map;
}

/**
 * Ranking igual a M2 (mayor delta de ICD gana), pero solo entra si el
 * retorno de PRECIO del ganador sobre lookbackDays >= k * su propia
 * volatilidad diaria historica escalada a ese periodo.
 */
function simulatePriceVolFilter(sectorMetrics, lookbackDays, volWindow, k) {
  const tickers = Object.keys(sectorMetrics).filter((t) => sectorMetrics[t].some((r) => r.ICD !== null));
  if (tickers.length === 0) return [];

  const icdByTicker = {};
  const closeByTicker = {};
  const volByTicker = {};
  const priceRetByTicker = {};
  for (const t of tickers) {
    icdByTicker[t] = new Map(sectorMetrics[t].map((r) => [r.date, r.ICD]));
    closeByTicker[t] = new Map(sectorMetrics[t].map((r) => [r.date, r.close]));
    volByTicker[t] = dailyVolMap(sectorMetrics[t], volWindow);
    priceRetByTicker[t] = priceReturnMap(sectorMetrics[t], lookbackDays);
  }

  const dateSet = new Set();
  for (const t of tickers) for (const r of sectorMetrics[t]) dateSet.add(r.date);
  const dates = Array.from(dateSet).sort();

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
      if (icdNow !== null && icdNow !== undefined && icdNow < 0 && closeNow !== undefined) {
        equityValue *= 1 + (closeNow / position.entryPrice - 1);
        equity.push({ date, value: equityValue });
        position = null;
      }
    }

    if (!position) {
      const lookbackDate = dates[i - lookbackDays];
      const bestTicker = pickBestTicker(date, lookbackDate);
      if (bestTicker !== null) {
        const priceRet = priceRetByTicker[bestTicker].get(date);
        const dailyVol = volByTicker[bestTicker].get(date);
        const sigmaLookback = dailyVol !== undefined ? dailyVol * Math.sqrt(lookbackDays) : undefined;
        const qualifies = priceRet !== undefined && sigmaLookback !== undefined && priceRet >= k * sigmaLookback;
        if (qualifies) {
          const entryPrice = closeByTicker[bestTicker].get(date);
          if (entryPrice !== undefined) {
            position = { ticker: bestTicker, entryPrice };
            if (equity.length === 0) equity.push({ date, value: 1.0 });
          }
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

  const windows = [
    ['BACKTEST (2018-2023)', BACKTEST_START, BACKTEST_END],
    ['VALIDACION (2024-2025)', VALIDATION_START, VALIDATION_END],
    ['LIVE (2026-presente)', LIVE_START, null],
  ];

  // k -> [sharpe_backtest, sharpe_validation, sharpe_live] y lo mismo para gain, para el resumen de robustez al final.
  const sharpeByK = {};
  const gainByK = {};
  for (const k of K_VALUES) {
    sharpeByK[k] = [];
    gainByK[k] = [];
  }
  let m2Sharpes = [];
  let m2Gains = [];

  for (const [label, start, end] of windows) {
    console.log(`\n=== ${label} ===`);
    const win = {};
    for (const [t, rows] of Object.entries(fullMetrics)) win[t] = sliceWindow(rows, start, end);

    const curveM2 = simulateIcdExitStrategy(win, LOOKBACK_DAYS);
    const statsM2 = computeStrategyStats(curveM2);
    console.log('  M2 (sin filtro de precio): ' + fmt(statsM2, curveM2));
    m2Sharpes.push(statsM2.sharpe ?? NaN);
    m2Gains.push(curveM2.length >= 2 ? curveM2[curveM2.length - 1].value / curveM2[0].value - 1 : NaN);

    for (const k of K_VALUES) {
      const curve = simulatePriceVolFilter(win, LOOKBACK_DAYS, VOL_WINDOW, k);
      const stats = computeStrategyStats(curve);
      console.log(`  M3 filtro vol precio (k=${k}):`.padEnd(28) + fmt(stats, curve));
      sharpeByK[k].push(stats.sharpe ?? NaN);
      gainByK[k].push(curve.length >= 2 ? curve[curve.length - 1].value / curve[0].value - 1 : NaN);
    }

    const spyWindow = priceBars.SPY.filter((b) => b.date >= start && (end === null || b.date <= end));
    const spyCurve = buyAndHoldCurve(spyWindow, curveM2.map((p) => p.date));
    console.log('  SPY buy&hold:              ' + fmt(computeStrategyStats(spyCurve), spyCurve));
  }

  console.log('\n=== Resumen de robustez: minimo de Sharpe y ganancia entre las 3 ventanas ===');
  const minM2Sharpe = Math.min(...m2Sharpes);
  const minM2Gain = Math.min(...m2Gains) * 100;
  console.log(`  M2 (sin filtro):    minSharpe=${minM2Sharpe.toFixed(2)}  minGain=${minM2Gain.toFixed(1)}%  (Backtest/Validacion/Live: ${m2Sharpes.map((s) => s.toFixed(2)).join('/')})`);
  const ranked = K_VALUES.map((k) => ({
    k,
    minSharpe: Math.min(...sharpeByK[k]),
    minGain: Math.min(...gainByK[k]) * 100,
    sharpes: sharpeByK[k],
  })).sort((a, b) => b.minSharpe - a.minSharpe);
  for (const r of ranked) {
    console.log(`  k=${String(r.k).padStart(4)}:            minSharpe=${r.minSharpe.toFixed(2)}  minGain=${r.minGain.toFixed(1)}%  (Backtest/Validacion/Live: ${r.sharpes.map((s) => s.toFixed(2)).join('/')})`);
  }
  console.log(`\n  Mejor k por robustez (minSharpe): ${ranked[0].k}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
