/**
 * Prueba OFFLINE (no toca engine.ts ni DensityLab.tsx) de una variante
 * diversificada de M4: en vez de concentrar el 100% del capital en el
 * ticker con mayor delta de ICD, mantiene un portafolio de N posiciones
 * simultaneas (top-N por delta de ICD), cada una con 1/N del capital.
 *
 * Misma regla de entrada/salida que M4 (ver scripts/testRegimeSwitchM4.mjs):
 * ranking por mayor delta de ICD, salida cuando ICD del ticker en cartera
 * cae bajo 0, filtro de vol. de precio de M3 solo quando el regimen de
 * SPY es de baja volatilidad. La unica diferencia es N slots
 * independientes en vez de 1 -- cada slot entra/sale por su cuenta, sin
 * forzar rebalanceo diario entre slots.
 *
 * Objetivo: cuantificar el trade-off entre concentracion (N=1, M4 actual)
 * y diversificacion (N=2, N=3) -- ¿baja el drawdown/Calmar lo suficiente
 * como para compensar diluir la señal de mayor conviccion?
 *
 * Correr con:
 *   node --experimental-strip-types scripts/testTopNDiversifiedM5.mjs
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
  simulateIcdRegimeSwitchStrategy,
  computeStrategyStats,
  buyAndHoldCurve,
} = engine;

const ROLLING_WINDOW = 42;
const LOOKBACK_DAYS = 9;
const FREE_FLOAT_RATIO = 0.95;
const PRICE_VOL_K = 0.25;
const PRICE_VOL_WINDOW = 60;
const SPY_VOL_WINDOW = 20;
const REGIME_WINDOW = 252;

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

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** Identica a buildRegimeMap de testRegimeSwitchM4.mjs. */
function buildRegimeMap(spyBars) {
  const dailyRets = [];
  for (let i = 1; i < spyBars.length; i++) dailyRets.push(spyBars[i].close / spyBars[i - 1].close - 1);

  const shortVol = new Map();
  for (let i = SPY_VOL_WINDOW - 1; i < dailyRets.length; i++) {
    const window = dailyRets.slice(i - SPY_VOL_WINDOW + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / (window.length - 1);
    shortVol.set(spyBars[i + 1].date, Math.sqrt(variance));
  }

  const shortVolDates = [...shortVol.keys()].sort();
  const shortVolVals = shortVolDates.map((d) => shortVol.get(d));

  const regime = new Map();
  for (let i = REGIME_WINDOW - 1; i < shortVolDates.length; i++) {
    const window = shortVolVals.slice(i - REGIME_WINDOW + 1, i + 1);
    const med = median(window);
    regime.set(shortVolDates[i], shortVolVals[i] > med ? 'high' : 'low');
  }
  return regime;
}

/**
 * M4 generalizado a N slots independientes. N=1 deberia reproducir
 * simulateIcdRegimeSwitchStrategy (validado en main() como chequeo de
 * cordura antes de mostrar N=2/N=3).
 */
function simulateTopNRegimeSwitch(sectorMetrics, lookbackDays, k, priceVolWindow, regimeMap, N) {
  const tickers = Object.keys(sectorMetrics).filter((t) => sectorMetrics[t].some((r) => r.ICD !== null));
  if (tickers.length === 0) return [];

  const icdByTicker = {};
  const closeByTicker = {};
  const dailyVolByTicker = {};
  const priceReturnByTicker = {};

  for (const t of tickers) {
    const rows = sectorMetrics[t];
    icdByTicker[t] = new Map(rows.map((r) => [r.date, r.ICD]));
    closeByTicker[t] = new Map(rows.map((r) => [r.date, r.close]));

    const dailyVol = new Map();
    const dailyRets = [];
    for (let i = 1; i < rows.length; i++) dailyRets.push(rows[i].close / rows[i - 1].close - 1);
    for (let i = priceVolWindow - 1; i < dailyRets.length; i++) {
      const window = dailyRets.slice(i - priceVolWindow + 1, i + 1);
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / (window.length - 1);
      dailyVol.set(rows[i + 1].date, Math.sqrt(variance));
    }
    dailyVolByTicker[t] = dailyVol;

    const priceReturn = new Map();
    for (let i = lookbackDays; i < rows.length; i++) {
      const now = rows[i].close;
      const before = rows[i - lookbackDays].close;
      if (before === 0) continue;
      priceReturn.set(rows[i].date, now / before - 1);
    }
    priceReturnByTicker[t] = priceReturn;
  }

  const dateSet = new Set();
  for (const t of tickers) for (const r of sectorMetrics[t]) dateSet.add(r.date);
  const dates = Array.from(dateSet).sort();

  function pickBestTicker(date, lookbackDate, exclude) {
    let bestTicker = null;
    let bestDelta = -Infinity;
    for (const t of tickers) {
      if (exclude.has(t)) continue;
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

  function qualifiesForEntry(ticker, date, regime) {
    if (regime !== 'low') return true; // 'high' o sin clasificar: entra como M2, sin filtro
    const priceReturn = priceReturnByTicker[ticker].get(date);
    const dailyVol = dailyVolByTicker[ticker].get(date);
    const sigmaLookback = dailyVol !== undefined ? dailyVol * Math.sqrt(lookbackDays) : undefined;
    return priceReturn !== undefined && sigmaLookback !== undefined && priceReturn >= k * sigmaLookback;
  }

  const slots = new Array(N).fill(null); // { ticker, entryPrice } | null
  const slotEquity = new Array(N).fill(1 / N);
  let started = false;
  let trades = 0;
  const equity = [];

  for (let i = lookbackDays; i < dates.length; i++) {
    const date = dates[i];
    const lookbackDate = dates[i - lookbackDays];

    // 1. salidas: cada slot ocupado revisa su propia señal (ICD < 0)
    for (let s = 0; s < N; s++) {
      const slot = slots[s];
      if (!slot) continue;
      const icdNow = icdByTicker[slot.ticker].get(date);
      const closeNow = closeByTicker[slot.ticker].get(date);
      if (icdNow !== null && icdNow !== undefined && icdNow < 0 && closeNow !== undefined) {
        slotEquity[s] *= 1 + (closeNow / slot.entryPrice - 1);
        slots[s] = null;
      }
    }

    // 2. entradas: llenar slots libres, uno a la vez (evita elegir el
    // mismo ticker para dos slots el mismo dia -- se recalcula
    // currentHeld en cada iteracion para reflejar los slots ya llenados
    // en este mismo dia).
    for (let s = 0; s < N; s++) {
      if (slots[s]) continue;
      const exclude = new Set(slots.filter(Boolean).map((sl) => sl.ticker));
      const bestTicker = pickBestTicker(date, lookbackDate, exclude);
      if (bestTicker === null) continue;
      const regime = regimeMap.get(date);
      if (!qualifiesForEntry(bestTicker, date, regime)) continue;
      const entryPrice = closeByTicker[bestTicker].get(date);
      if (entryPrice === undefined) continue;
      slots[s] = { ticker: bestTicker, entryPrice };
      started = true;
      trades++;
    }

    if (started) {
      const total = slots.reduce((sum, slot, s) => {
        if (!slot) return sum + slotEquity[s];
        const closeNow = closeByTicker[slot.ticker].get(date);
        const liveValue = closeNow !== undefined ? slotEquity[s] * (1 + (closeNow / slot.entryPrice - 1)) : slotEquity[s];
        return sum + liveValue;
      }, 0);
      equity.push({ date, value: total });
    }
  }

  const curve = equity.length >= 2 ? equity : [];
  curve.trades = trades;
  return curve;
}

function fmt(stats, curve) {
  const gain = curve.length >= 2 ? ((curve[curve.length - 1].value / curve[0].value - 1) * 100).toFixed(1) + '%' : 'n/a';
  const sharpe = stats.sharpe !== null ? stats.sharpe.toFixed(2) : 'n/a';
  const calmar = stats.calmarRatio === null ? 'n/a' : stats.calmarRatio === Infinity ? '∞' : stats.calmarRatio.toFixed(2);
  const dd = stats.maxDrawdownPct !== null ? '-' + stats.maxDrawdownPct.toFixed(1) + '%' : 'n/a';
  return `trades=${String(curve.trades ?? stats.trades).padStart(3)} sharpe=${sharpe.padStart(5)} calmar=${calmar.padStart(5)} maxDD=${dd.padStart(7)} gain=${gain.padStart(8)}`;
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
  const regimeMap = buildRegimeMap(priceBars.SPY);

  const NS = [1, 2, 3];
  const results = { 1: { sharpes: [], calmars: [], dds: [] }, 2: { sharpes: [], calmars: [], dds: [] }, 3: { sharpes: [], calmars: [], dds: [] } };

  console.log('\nChequeo de cordura: N=1 debe reproducir M4 puro (simulateIcdRegimeSwitchStrategy) casi exacto.');

  for (const [label, start, end] of [
    ['BACKTEST (2018-2023)', BACKTEST_START, BACKTEST_END],
    ['VALIDACION (2024-2025)', VALIDATION_START, VALIDATION_END],
    ['LIVE (2026-presente)', LIVE_START, null],
  ]) {
    console.log(`\n=== ${label} ===`);
    const win = {};
    for (const [t, rows] of Object.entries(fullMetrics)) win[t] = sliceWindow(rows, start, end);

    const curveM4Ref = simulateIcdRegimeSwitchStrategy(win, LOOKBACK_DAYS, PRICE_VOL_K, regimeMap);
    const statsM4Ref = computeStrategyStats(curveM4Ref);
    console.log('  M4 produccion (N=1, referencia):  ' + fmt(statsM4Ref, curveM4Ref));

    for (const N of NS) {
      const curve = simulateTopNRegimeSwitch(win, LOOKBACK_DAYS, PRICE_VOL_K, PRICE_VOL_WINDOW, regimeMap, N);
      const stats = computeStrategyStats(curve);
      const tag = N === 1 ? 'M5 (N=1, debe calzar con M4)' : `M5 (top-${N} diversificado)  `;
      console.log(`  ${tag}: ` + fmt(stats, curve));
      results[N].sharpes.push(stats.sharpe ?? NaN);
      results[N].calmars.push(stats.calmarRatio ?? NaN);
      results[N].dds.push(stats.maxDrawdownPct ?? NaN);
    }

    const spyWindow = priceBars.SPY.filter((b) => b.date >= start && (end === null || b.date <= end));
    const spyFull = buyAndHoldCurve(spyWindow, spyWindow.map((b) => b.date));
    const spyGain = spyFull.length >= 2 ? ((spyFull[spyFull.length - 1].value / spyFull[0].value - 1) * 100).toFixed(1) + '%' : 'n/a';
    console.log('  SPY real (ventana completa):        gain=' + spyGain);
  }

  console.log('\n=== Resumen: minimo entre las 3 ventanas (robustez) ===');
  for (const N of NS) {
    const minSharpe = Math.min(...results[N].sharpes);
    const finiteCalmars = results[N].calmars.filter((c) => Number.isFinite(c));
    const minCalmar = finiteCalmars.length ? Math.min(...finiteCalmars) : NaN;
    const maxDD = Math.max(...results[N].dds.filter((d) => Number.isFinite(d)));
    console.log(
      `  N=${N}: minSharpe=${minSharpe.toFixed(2)}  minCalmar(finito)=${minCalmar.toFixed(2)}  peorMaxDD=-${maxDD.toFixed(1)}%` +
        `  (sharpe por ventana: ${results[N].sharpes.map((s) => s.toFixed(2)).join('/')})`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
